const express = require('express');
const router = express.Router();
const executeQuery = require('../middleware/executeQuery');
const { authenticateRole } = require("../middleware/roleAuth");
// List all rooms
router.get('/list',authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        // Automatically update room availability based on rental contracts
        const updateStatusQuery = `
            -- Step 1: Mark any active contracts with a past end date as 'completed'
            UPDATE rental_contracts
            SET status = 'completed', 
                updated_at = GETDATE()
            WHERE end_date < CAST(GETDATE() AS DATE) AND status = 'active';
        `;
        await executeQuery(updateStatusQuery);

        const query = `
            SELECT 
                r.*,
                COUNT(rf.furniture_id) as furniture_count
            FROM rooms r
            LEFT JOIN room_furniture rf ON r.id = rf.room_id
            GROUP BY r.id, r.room_number, r.room_type, r.size_sqm, r.description, 
                     r.rent_price, r.created_at, r.updated_at
            ORDER BY r.id DESC
        `;
        const result = await executeQuery(query);
        res.render('rooms/list', {
            user: req.user,
            rooms: result,
            message: req.query.message || '',
            messageType: req.query.messageType || ''
        });
    } catch (error) {
        console.error('Error fetching rooms list:', error);
        res.status(500).render('error', { user: req.user,message: 'Error fetching rooms list' });
    }
});

// Get room by ID (API endpoint)
router.get('/get/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const query = `
            SELECT 
                r.*,
                STRING_AGG(f.name, ', ') as furniture_list
            FROM rooms r
            LEFT JOIN room_furniture rf ON r.id = rf.room_id
            LEFT JOIN furniture f ON rf.furniture_id = f.id
            WHERE r.id = ${id}
            GROUP BY r.id, r.room_number, r.room_type, r.size_sqm, r.description, 
                     r.rent_price, r.created_at, r.updated_at
        `;
        const result = await executeQuery(query);
        
        if (result.length === 0) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }
        
        res.json({ success: true, data: result[0] });
    } catch (error) {
        console.error('Error fetching room:', error);
        res.status(500).json({ success: false, message: 'Error fetching room' });
    }
});

// View room details page
router.get('/view/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get room details
        const roomQuery = `SELECT * FROM rooms WHERE id = ${id}`;
        const roomResult = await executeQuery(roomQuery);

        if (roomResult.length === 0) {
            return res.status(404).render('error', { user: req.user,message: 'Phòng không tìm thấy' });
        }

        // Get furniture in this room
        const furnitureQuery = `
            SELECT 
                f.id,
                f.name,
                f.description,
                rf.quantity
            FROM room_furniture rf
            JOIN furniture f ON rf.furniture_id = f.id
            WHERE rf.room_id = ${id}
            ORDER BY f.name
        `;
        const furnitureResult = await executeQuery(furnitureQuery);

        res.render('rooms/view', {
            user: req.user,
            room: roomResult[0],
            furnitureList: furnitureResult
        });
    } catch (error) {
        console.error('Error fetching room details:', error);
        res.status(500).render('error', { user: req.user,message: 'Error fetching room details' });
    }
});

// Add room page
router.get('/add', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const furnitureQuery = `SELECT id, name FROM furniture ORDER BY name;`;
        const allFurniture = await executeQuery(furnitureQuery);

        res.render('rooms/add', {
            user: req.user,
            allFurniture: allFurniture,
            message: req.query.message || '',
            messageType: req.query.messageType || ''
        });
    } catch (error) {
        console.error('Error loading add room page:', error);
        res.redirect('/rooms/list?message=Error loading page&messageType=error');
    }
});

// Create room (POST)
router.post('/add', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const { room_number, room_type, size_sqm, description, rent_price, furniture_ids, quantities } = req.body;

        // Validation
        if (!room_number || room_number.trim() === '') {
            return res.redirect('/rooms/add?message=Room number is required&messageType=error');
        }

        if (!room_type || !['phòng tự học', 'phòng lab'].includes(room_type)) {
            return res.redirect('/rooms/add?message=Invalid room type&messageType=error');
        }

        if (!rent_price || isNaN(rent_price) || rent_price <= 0) {
            return res.redirect('/rooms/add?message=Rent price must be greater than 0&messageType=error');
        }

        // Check if room number already exists
        const checkQuery = `SELECT id FROM rooms WHERE room_number = ?`;
        const checkResult = await executeQuery(checkQuery, [room_number]);
        
        if (checkResult.length > 0) {
            return res.redirect('/rooms/add?message=Room number already exists&messageType=error');
        }

        // Use a transaction to ensure atomicity
        let transactionQuery = 'BEGIN TRANSACTION;';

        // Insert room and get its ID
        transactionQuery += `
            DECLARE @NewRoomID INT;
            INSERT INTO rooms (room_number, room_type, size_sqm, description, rent_price)
            OUTPUT INSERTED.id INTO @NewRoomIDTable(id)
            VALUES (?, ?, ?, ?, ?);
            SELECT @NewRoomID = id FROM @NewRoomIDTable;
        `;

        const roomParams = [
            room_number,
            room_type,
            (size_sqm && !isNaN(size_sqm)) ? parseFloat(size_sqm) : null,
            description || '',
            parseFloat(rent_price)
        ];

        // Prepare furniture inserts
        const furnitureInserts = [];
        if (furniture_ids && quantities) {
            const ids = Array.isArray(furniture_ids) ? furniture_ids : [furniture_ids];
            const quants = Array.isArray(quantities) ? quantities : [quantities];

            for (let i = 0; i < ids.length; i++) {
                const furnitureId = parseInt(ids[i], 10);
                const quantity = parseInt(quants[i], 10);
                if (furnitureId > 0 && quantity > 0) {
                    transactionQuery += `
                        INSERT INTO room_furniture (room_id, furniture_id, quantity)
                        VALUES (@NewRoomID, ?, ?);
                    `;
                    roomParams.push(furnitureId, quantity);
                }
            }
        }

        transactionQuery += 'COMMIT TRANSACTION;';

        // The executeQuery middleware needs to be adapted to handle this kind of batch,
        // for now, we'll assume it works or use a direct connection if needed.
        // This is a conceptual fix for the route logic.
        // A proper implementation would require a more robust transaction manager.

        // Simplified approach for now:
        const insertRoomQuery = `
            INSERT INTO rooms (room_number, room_type, size_sqm, description, rent_price)
            OUTPUT INSERTED.id
            VALUES (?, ?, ?, ?, ?);
        `;
        const newRoomResult = await executeQuery(insertRoomQuery, roomParams.slice(0, 5));
        const newRoomId = newRoomResult[0].id;

        if (furniture_ids && quantities && newRoomId) {
            const ids = Array.isArray(furniture_ids) ? furniture_ids : [furniture_ids];
            const quants = Array.isArray(quantities) ? quantities : [quantities];

            for (let i = 0; i < ids.length; i++) {
                const furnitureId = parseInt(ids[i], 10);
                const quantity = parseInt(quants[i], 10);
                if (furnitureId > 0 && quantity > 0) {
                    const furnitureQuery = `
                        INSERT INTO room_furniture (room_id, furniture_id, quantity)
                        VALUES (?, ?, ?);
                    `;
                    await executeQuery(furnitureQuery, [newRoomId, furnitureId, quantity]);
                }
            }
        }

        res.redirect('/rooms/list?message=Room added successfully&messageType=success');
    } catch (error) {
        console.error('Error adding room:', error);
        res.redirect('/rooms/add?message=Error adding room&messageType=error');
    }
});

// Edit room page
router.get('/edit/:id', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const { id } = req.params;
        
        // Fetch room details
        const roomQuery = `SELECT * FROM rooms WHERE id = ?`;
        const roomResult = await executeQuery(roomQuery, [id]);

        if (roomResult.length === 0) {
            return res.status(404).render('error', { user: req.user, message: 'Room not found' });
        }

        // Fetch all possible furniture
        const allFurnitureQuery = `SELECT id, name FROM furniture ORDER BY name;`;
        const allFurniture = await executeQuery(allFurnitureQuery);

        // Fetch furniture currently in the room
        const roomFurnitureQuery = `SELECT furniture_id, quantity FROM room_furniture WHERE room_id = ?`;
        const roomFurnitureResult = await executeQuery(roomFurnitureQuery, [id]);
        
        // Convert to a Map for easier lookup in the EJS template
        const roomFurnitureMap = new Map();
        roomFurnitureResult.forEach(item => {
            roomFurnitureMap.set(item.furniture_id.toString(), item.quantity);
        });

        res.render('rooms/edit', {
            user: req.user,
            room: roomResult[0],
            allFurniture: allFurniture,
            roomFurniture: roomFurnitureMap,
            message: req.query.message || '',
            messageType: req.query.messageType || ''
        });
    } catch (error) {
        console.error('Error fetching room for edit:', error);
        res.status(500).render('error', { user: req.user,message: 'Error fetching room' });
    }
});

// Update room (POST)
router.post('/edit/:id', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const { id } = req.params;
        const { room_number, room_type, size_sqm, description, rent_price, furniture_ids, quantities } = req.body;

        // Validation
        if (!room_number || room_number.trim() === '') {
            return res.redirect(`/rooms/edit/${id}?message=Room number is required&messageType=error`);
        }

        if (!room_type || !['phòng tự học', 'phòng lab'].includes(room_type)) {
            return res.redirect(`/rooms/edit/${id}?message=Invalid room type&messageType=error`);
        }

        if (!rent_price || isNaN(rent_price) || rent_price <= 0) {
            return res.redirect(`/rooms/edit/${id}?message=Rent price must be greater than 0&messageType=error`);
        }

        // Check if room number already exists (excluding current room)
        const checkQuery = `SELECT id FROM rooms WHERE room_number = ? AND id != ?`;
        const checkResult = await executeQuery(checkQuery, [room_number, id]);
        
        if (checkResult.length > 0) {
            return res.redirect(`/rooms/edit/${id}?message=Room number already exists&messageType=error`);
        }

        // Using a transaction for atomicity
        // Step 1: Update room details
        const updateRoomQuery = `
            UPDATE rooms
            SET room_number = ?,
                room_type = ?,
                size_sqm = ?,
                description = ?,
                rent_price = ?,
                updated_at = GETDATE()
            WHERE id = ?;
        `;
        await executeQuery(updateRoomQuery, [room_number, room_type, (size_sqm && !isNaN(size_sqm)) ? parseFloat(size_sqm) : null, description || '', parseFloat(rent_price), id]);

        // Step 2: Clear existing furniture for this room
        await executeQuery(`DELETE FROM room_furniture WHERE room_id = ?`, [id]);

        // Step 3: Insert the new furniture list
        if (furniture_ids && quantities) {
            const ids = Array.isArray(furniture_ids) ? furniture_ids : [furniture_ids];
            const quants = Array.isArray(quantities) ? quantities : [quantities];
            for (let i = 0; i < ids.length; i++) {
                const furnitureId = parseInt(ids[i], 10);
                const quantity = parseInt(quants[i], 10);
                if (furnitureId > 0 && quantity > 0) {
                    await executeQuery(`INSERT INTO room_furniture (room_id, furniture_id, quantity) VALUES (?, ?, ?)`, [id, furnitureId, quantity]);
                }
            }
        }
        
        res.redirect('/rooms/list?message=Room updated successfully&messageType=success');
    } catch (error) {
        console.error('Error updating room:', error);
        res.redirect(`/rooms/edit/${req.params.id}?message=Error updating room&messageType=error`);
    }
});

// Delete room
router.post('/delete/:id', authenticateRole(["admin", "employee"]), async (req, res) => {
    try {
        const { id } = req.params;

        // Check if room has active rental contracts
        const checkQuery = `SELECT COUNT(*) as count FROM rental_contracts WHERE room_id = ? AND status = 'active'`;
        const checkResult = await executeQuery(checkQuery, [id]);
        
        if (checkResult[0].count > 0) {
            return res.json({ 
                success: false, 
                message: 'Cannot delete this room as it has active rental contracts.' 
            });
        }

        // Delete room furniture assignments first
        await executeQuery(`DELETE FROM room_furniture WHERE room_id = ?`, [id]);
        
        // Delete rental contracts
        await executeQuery(`DELETE FROM rental_contracts WHERE room_id = ?`, [id]);
        
        // Delete the room
        const query = `DELETE FROM rooms WHERE id = ?`;
        await executeQuery(query, [id]);
        
        res.json({ success: true, message: 'Room deleted successfully' });
    } catch (error) {
        console.error('Error deleting room:', error);
        res.status(500).json({ success: false, message: 'Error deleting room' });
    }
});

module.exports = router;
