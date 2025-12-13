const express = require("express");
const router = express.Router();
const { body, validationResult } = require('express-validator');
const executeQuery = require("../middleware/executeQuery");
const { checkAuthenticated } = require("../middleware/auth");
const { authenticateRole } = require("../middleware/roleAuth");
// Route to display all available rooms for rent
router.get("/", checkAuthenticated, async (req, res) => {
  try {
    // This query fetches all available rooms and aggregates their furniture into a single string.
    // STRING_AGG is available in SQL Server 2017 and later.
    const query = `
      SELECT
        r.id,
        r.room_number,
        r.room_type,
        r.description,
        r.rent_price,
        (
          SELECT STRING_AGG(CONCAT(f.name, ' (', rf.quantity, ')'), ', ')
          FROM room_furniture rf
          JOIN furniture f ON f.id = rf.furniture_id
          WHERE rf.room_id = r.id
        ) AS furniture_list
      FROM rooms r
      ORDER BY r.room_number;
    `;

    const rooms = await executeQuery(query);

    res.render("rent/index.ejs", {
      user: req.user, // Make sure user is passed
      rooms: rooms,
      page_name: "rooms",
    });
  } catch (error) {
    console.error("Error fetching rooms:", error);
    req.flash("error", "Could not load rooms.");
    res.redirect("/");
  }
});

// You can add more room-related routes here, like for viewing a single room
// or handling the rental process.

// GET /rental/new - Show the rental confirmation page for a specific room
router.get("/new", checkAuthenticated, async (req, res) => {
  const { room_id } = req.query;

  if (!room_id) {
    req.flash("error", "No room selected.");
    return res.redirect("/renting"); // Redirect to the room list
  }

  try {
    // Query to get room details
    const roomQuery = `SELECT * FROM rooms WHERE id = ?`;
    const roomResult = await executeQuery(roomQuery, [room_id]);

    if (roomResult.length === 0) {
      req.flash("error", "The selected room is not available or does not exist.");
      return res.redirect("/renting");
    }

    // Query to get the furniture in the room
    const furnitureQuery = `
      SELECT f.name, rf.quantity
      FROM room_furniture rf
      JOIN furniture f ON rf.furniture_id = f.id
      WHERE rf.room_id = ?
      ORDER BY f.name;
    `;
    const furniture = await executeQuery(furnitureQuery, [room_id]);

    res.render("rent/new.ejs", {
      user: req.user,
      room: roomResult[0],
      furniture: furniture,
      page_name: "rent",
      messages: req.flash(),
    });
  } catch (error) {
    console.error("Error fetching room for rental:", error);
    req.flash("error", "Could not load the rental page.");
    res.redirect("/renting");
  }
});

// POST /renting/create - Handle the rental form submission
router.post(
  "/create",
  checkAuthenticated,
  // Basic validation and sanitization
  [
    body('room_id').isInt(),
    body('start_date').isISO8601().toDate(),
    body('end_date').isISO8601().toDate().custom((value, { req }) => {
      if (value < req.body.start_date) {
        throw new Error('End date must be after start date.');
      }
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const { room_id, start_date, end_date } = req.body;

    if (!errors.isEmpty()) {
      req.flash("error", "Invalid data submitted. Please check your dates.");
      return res.redirect(`/renting/new?room_id=${room_id}`);
    }

    try {
      // 1. Check for booking conflicts
      const conflictQuery = `
        SELECT COUNT(id) as conflict_count
        FROM rental_contracts
        WHERE room_id = ?
          AND status IN ('active', 'pending')
          AND (start_date <= ? AND end_date >= ?)
      `;
      const conflictResult = await executeQuery(conflictQuery, [room_id, end_date, start_date]);

      if (conflictResult[0].conflict_count > 0) {
        req.flash("error", "Sorry, this room is already booked for the selected dates. Please choose a different period.");
        return res.redirect(`/renting/new?room_id=${room_id}`);
      }

      // 2. Get room price and customer ID for the contract
      const roomQuery = `SELECT rent_price FROM rooms WHERE id = ?`;
      const roomResult = await executeQuery(roomQuery, [room_id]);

      const customerQuery = `SELECT id FROM customers WHERE user_id = ?`;
      const customerResult = await executeQuery(customerQuery, [req.user.id]);

      if (roomResult.length === 0 || customerResult.length === 0) {
        req.flash("error", "An unexpected error occurred (could not find room or customer).");
        return res.redirect(`/renting`);
      }

      const roomPrice = roomResult[0].rent_price;
      const customerId = customerResult[0].id;

      // 3. Calculate total rent on the backend for security
      const oneDay = 1000 * 60 * 60 * 24;
      const rentalDays = Math.round(Math.abs((end_date - start_date) / oneDay)) + 1;
      const totalRent = rentalDays * roomPrice;

      // 4. Create the rental contract
      // Use the OUTPUT clause to get the ID of the inserted row. This is more reliable
      // than SCOPE_IDENTITY() as it returns a single, predictable result set.
      const createContractQuery = `
        INSERT INTO rental_contracts (customer_id, room_id, start_date, end_date, total_rent, status)
        OUTPUT INSERTED.id
        VALUES (?, ?, ?, ?, ?, 'pending');
      `;
      const result = await executeQuery(createContractQuery, [customerId, room_id, start_date, end_date, totalRent]);
      const newContractId = result[0].id;

      // 5. Redirect to the new checkout page
      res.redirect(`/renting/checkout/${newContractId}`);

    } catch (error) {
      console.error("Error creating rental contract:", error);
      req.flash("error", "An server error occurred while trying to book the room.");
      res.redirect(`/renting/new?room_id=${room_id}`);
    }
  }
);

// GET /renting/checkout/:id - Show the checkout page for a specific contract
router.get("/checkout/:id", checkAuthenticated, async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
      SELECT 
        rc.*,
        r.room_number,
        r.description
      FROM rental_contracts rc
      JOIN rooms r ON rc.room_id = r.id
      WHERE rc.id = ? AND rc.status = 'pending'
    `;
    const contractResult = await executeQuery(query, [id]);

    if (contractResult.length === 0) {
      req.flash("error", "This contract is either invalid or has already been processed.");
      return res.redirect("/rooms");
    }

    res.render("rent/checkout.ejs", {
      user: req.user,
      contract: contractResult[0],
      page_name: "rent",
      messages: req.flash()
    });

  } catch (error) {
    console.error("Error loading checkout page:", error);
    req.flash("error", "Could not load the checkout page.");
    res.redirect("/rooms");
  }
});

// POST /renting/pay - Handle the payment submission
router.post("/pay", checkAuthenticated, async (req, res) => {
  const { contract_id, payment_method } = req.body;

  if (!contract_id || !payment_method) {
    req.flash("error", "Invalid payment submission.");
    return res.redirect("/rooms");
  }

  try {
    // Fetch contract to get total_rent
    const contractQuery = `SELECT total_rent FROM rental_contracts WHERE id = ? AND status = 'pending'`;
    const contractResult = await executeQuery(contractQuery, [contract_id]);

    if (contractResult.length === 0) {
      req.flash("error", "This contract is no longer valid for payment.");
      return res.redirect("/rooms");
    }
    const amount = contractResult[0].total_rent;

    let paymentStatus = 'pending';
    let contractStatus = 'pending';
    let successMessage = `Your booking is pending. Please complete the payment in cash with our staff to activate your rental. Your Contract ID is ${contract_id}.`;

    if (payment_method === 'card') {
      // In a real application, this is where you would process the card with a payment gateway (e.g., Stripe, PayPal).
      // For this demo, we'll assume the payment is successful immediately.
      paymentStatus = 'completed';
      contractStatus = 'active';
      successMessage = "Payment successful! Your room booking is now active.";
    }

    // Create payment record and update contract status in a single transaction
    const paymentQuery = `
      BEGIN TRY
        BEGIN TRANSACTION;
        
        INSERT INTO payments (rental_contract_id, amount, payment_method, status)
        VALUES (?, ?, ?, ?);
        
        UPDATE rental_contracts SET status = ? WHERE id = ?;

        COMMIT TRANSACTION;
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0
          ROLLBACK TRANSACTION;
        THROW;
      END CATCH;
    `;
    await executeQuery(paymentQuery, [contract_id, amount, payment_method, paymentStatus, contractStatus, contract_id]);

    req.flash("success", successMessage);
    // Redirect to the user's personal rental page
    res.redirect('/renting/my-rentals');
  } catch (error) {
    console.error("Error processing payment:", error);
    req.flash("error", "An error occurred during payment processing.");
    res.redirect(`/renting/checkout/${contract_id}`);
  }
});

// GET /renting/pending - Admin/Employee page to view pending cash payments
router.get("/pending", checkAuthenticated, authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const query = `
            SELECT p.id as payment_id, p.payment_date, p.amount, rc.id as contract_id, r.room_number, u.full_name
            FROM payments p
            JOIN rental_contracts rc ON p.rental_contract_id = rc.id
            JOIN rooms r ON rc.room_id = r.id
            JOIN customers c ON rc.customer_id = c.id
            JOIN users u ON c.user_id = u.id
            WHERE p.status = 'pending' AND p.payment_method = 'cash'
            ORDER BY p.payment_date DESC
        `;
        const pendingPayments = await executeQuery(query);
        res.render('rent/pending.ejs', {
            user: req.user,
            payments: pendingPayments,
            page_name: 'rent',
            messages: req.flash()
        });
    } catch (error) {
        console.error("Error fetching pending payments:", error);
        req.flash("error", "Could not load pending payments.");
        res.redirect('/');
    }
});

// GET /renting/in-progress - Admin/Employee page to view all ongoing rentals
router.get("/in-progress", checkAuthenticated, authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const query = `
            SELECT 
                rc.id as contract_id, 
                rc.start_date, 
                rc.end_date, 
                rc.total_rent,
                r.room_number, 
                u.full_name
            FROM rental_contracts rc
            JOIN rooms r ON rc.room_id = r.id
            JOIN customers c ON rc.customer_id = c.id
            JOIN users u ON c.user_id = u.id
            WHERE 
                rc.status = 'active' 
                AND CAST(GETDATE() AS DATE) BETWEEN rc.start_date AND rc.end_date
            ORDER BY rc.end_date ASC;
        `;
        const inProgressRentals = await executeQuery(query);

        res.render('rent/in-progress.ejs', {
            user: req.user,
            rentals: inProgressRentals,
            page_name: 'rent',
            messages: req.flash()
        });
    } catch (error) {
        console.error("Error fetching in-progress rentals:", error);
        req.flash("error", "Could not load the list of in-progress rentals.");
        res.redirect('/');
    }
});

// GET /renting/my-rentals - Show the current user their rentals
router.get("/my-rentals", checkAuthenticated, async (req, res) => {
    try {
        const customerQuery = `SELECT id FROM customers WHERE user_id = ?`;
        const customerResult = await executeQuery(customerQuery, [req.user.id]);

        if (customerResult.length === 0) {
            // This user is not a customer, so they have no rentals.
            return res.render('rent/my-rentals.ejs', {
                user: req.user,
                rentals: [],
                page_name: 'rent',
                messages: req.flash()
            });
        }

        const customerId = customerResult[0].id;

        const rentalsQuery = `
            SELECT 
                rc.id, rc.start_date, rc.end_date, rc.total_rent, rc.status as contract_status,
                r.room_number, r.description,
                p.payment_method, p.status as payment_status
            FROM rental_contracts rc
            JOIN rooms r ON rc.room_id = r.id
            LEFT JOIN payments p ON rc.id = p.rental_contract_id
            WHERE rc.customer_id = ? AND rc.status != 'completed'
            ORDER BY rc.start_date ASC
        `;

        const rentals = await executeQuery(rentalsQuery, [customerId]);

        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalize today's date

        // Process rentals to add a user-friendly display status
        const processedRentals = rentals.map(rental => {
            const startDate = new Date(rental.start_date);
            startDate.setHours(0, 0, 0, 0); // Normalize start date
            const endDate = new Date(rental.end_date);
            endDate.setHours(0, 0, 0, 0); // Normalize end date

            let displayStatus = { text: 'Unknown', class: 'secondary' };

            if (rental.contract_status === 'pending' && rental.payment_method === 'cash') {
                displayStatus = { text: 'Awaiting Payment', class: 'warning' };
            } else if (rental.contract_status === 'active') {
                // A rental is 'In Progress' if today is on or after the start date and on or before the end date.
                // We compare timestamps of dates that have been normalized to midnight.
                if (today.getTime() >= startDate.getTime() && today.getTime() <= endDate.getTime()) {
                    displayStatus = { text: 'In Progress', class: 'success' };
                } else if (today.getTime() < startDate.getTime()) {
                    displayStatus = { text: 'Pending', class: 'info' };
                } 
            } else if (rental.contract_status === 'completed') {
                displayStatus = { text: 'Completed', class: 'secondary' };
            }

            return { ...rental, displayStatus };
        });

        res.render('rent/my-rentals.ejs', {
            user: req.user,
            rentals: processedRentals,
            page_name: 'rent',
            messages: req.flash()
        });

    } catch (error) {
        console.error("Error fetching user rentals:", error);
        req.flash("error", "Could not load your rentals.");
        res.redirect('/');
    }
});

// POST /renting/confirm-payment/:payment_id - Admin confirms a cash payment
router.post('/confirm-payment/:payment_id', checkAuthenticated, authenticateRole(['admin', 'employee']), async (req, res) => {
    const { payment_id } = req.params;
    try {
        const query = `
            UPDATE payments SET status = 'completed' WHERE id = ? AND status = 'pending';
            UPDATE rental_contracts SET status = 'active' WHERE id = (SELECT rental_contract_id FROM payments WHERE id = ?);
        `;
        await executeQuery(query, [payment_id, payment_id]);
        req.flash('success', 'Payment confirmed and contract activated.');
        res.redirect('/renting/pending');
    } catch (error) {
        console.error("Error confirming payment:", error);
        req.flash('error', 'Failed to confirm payment.');
        res.redirect('/renting/pending');
    }
});

// POST /renting/cancel-pending - Handle abandoned checkout
router.post('/cancel-pending', checkAuthenticated, async (req, res) => {
    const { contract_id } = req.body;

    if (!contract_id) {
        return res.status(400).json({ success: false, message: 'Contract ID is required.' });
    }

    try {
        // Ensure the contract belongs to the current user before deleting
        const customerQuery = `SELECT id FROM customers WHERE user_id = ?`;
        const customerResult = await executeQuery(customerQuery, [req.user.id]);

        if (customerResult.length === 0) {
            // This should not happen if they have a contract, but it's a good safeguard.
            return res.status(403).json({ success: false, message: 'User is not a customer.' });
        }
        const customerId = customerResult[0].id;

        const deleteQuery = `
            DELETE FROM rental_contracts 
            WHERE id = ? AND customer_id = ? AND status = 'pending'
        `;
        await executeQuery(deleteQuery, [contract_id, customerId]);

        res.status(200).json({ success: true, message: 'Pending contract cancellation processed.' });
    } catch (error) {
        console.error("Error cancelling pending contract:", error);
        res.status(500).json({ success: false, message: 'Server error during cancellation.' });
    }
});

module.exports = router;
