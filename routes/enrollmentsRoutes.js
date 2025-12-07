const express = require("express");
const sql = require("msnodesqlv8");
const { authenticateRole } = require("../middleware/roleAuth");
const connectionString = process.env.CONNECTION_STRING;
const executeQuery = require("../middleware/executeQuery");
const { checkAuthenticated } = require("../middleware/auth");
const router = express.Router();

router.get(
  "/enrollments",
  checkAuthenticated,
  authenticateRole("admin"),
  (req, res) => {
    const query = `
    SELECT 
      e.id, 
      u.full_name AS student_name, 
      c.class_name,
      co.tuition_fee,
      e.enrollment_date,
      e.payment_status,
      e.payment_date
    FROM enrollments e
    JOIN students s ON e.student_id = s.id
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON e.class_id = c.id
    JOIN courses co ON c.course_id = co.id
    ORDER BY e.enrollment_date DESC
  `;

    sql.query(connectionString, query, (err, rows) => {
      if (err) {
        console.error("Fetch enrollments error:", err);
        return res.status(500).send("Database error");
      }
      res.render("enrollments/enrollments", {
        enrollments: rows,
        user: req.user,
      });
    });
  }
);

router.delete(
  "/enrollments/:id",
  checkAuthenticated,
  authenticateRole("admin"),
  async (req, res) => {
    try {
      const enrollmentId = req.params.id;

      // First check if enrollment exists
      const checkQuery = `
        SELECT e.id, e.student_id, u.full_name, c.class_name 
        FROM enrollments e
        JOIN students s ON e.student_id = s.id
        JOIN users u ON s.user_id = u.id
        JOIN classes c ON e.class_id = c.id
        WHERE e.id = ?
      `;

      const enrollment = await executeQuery(checkQuery, [enrollmentId]);

      if (!enrollment.length) {
        return res.status(404).json({
          error: "Enrollment not found",
          code: "ENROLLMENT_NOT_FOUND",
        });
      }

      // Log deletion attempt for audit
      console.log("Deleting enrollment:", {
        id: enrollmentId,
        student: enrollment[0].full_name,
        class: enrollment[0].class_name,
      });

      // Delete enrollment
      const deleteQuery = "DELETE FROM enrollments WHERE id = ?";
      await executeQuery(deleteQuery, [enrollmentId]);

      // Add notification for student (use the related users.id)
      const notifyQuery = `
        INSERT INTO notifications (user_id, message, sent_at)
        VALUES ((SELECT user_id FROM students WHERE id = ?), ?, GETDATE())
      `;

      await executeQuery(notifyQuery, [
        enrollment[0].student_id,
        `Your enrollment in ${enrollment[0].class_name} has been cancelled.`,
      ]);

      res.redirect("/enrollments");
    } catch (error) {
      console.error("Enrollment deletion error:", {
        enrollmentId: req.params.id,
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        error: "Failed to delete enrollment",
        code: "DELETE_FAILED",
        message: "An error occurred while deleting the enrollment",
      });
    }
  }
);

router.post(
  "/enrollments/:id/toggle-payment",
  checkAuthenticated,
  authenticateRole("admin"),
  (req, res) => {
    const query = `
    UPDATE enrollments 
    SET 
      payment_status = ~payment_status,
      payment_date = CASE 
        WHEN payment_status = 0 THEN GETDATE()
        ELSE NULL 
      END,
      updated_at = GETDATE()
    WHERE id = ?
  `;

    sql.query(connectionString, query, [req.params.id], (err) => {
      try {
        if (err) {
          console.error("Update payment status error:", err);
          if (!res.headersSent) {
            return res.status(500).json({ error: "Update failed" });
          }
        }
        if (!res.headersSent) {
          res.json({ success: true });
        }
      } catch (error) {
        // Only log non-headers-sent errors
        if (error.code !== "ERR_HTTP_HEADERS_SENT") {
          console.error("Error in payment toggle:", error);
        }
      }
    });
  }
);

router.get(
  "/enrollments/:id/edit",
  checkAuthenticated,
  authenticateRole("admin"),
  async (req, res) => {
    try {
      const id = req.params.id;

      // Get enrollment details with related info
      const enrollmentQuery = `
        SELECT 
          e.*,
          u.full_name AS student_name,
          c.class_name,
          co.course_name,
          co.tuition_fee
        FROM enrollments e
        JOIN students s ON e.student_id = s.id
        JOIN users u ON s.user_id = u.id
        JOIN classes c ON e.class_id = c.id
        JOIN courses co ON c.course_id = co.id
        WHERE e.id = ?
      `;

      // Get available students and classes for dropdown
      const studentQuery = `
        SELECT s.id, u.full_name, u.email 
        FROM students s
        JOIN users u ON s.user_id = u.id
        LEFT JOIN enrollments e ON s.id = e.student_id
        GROUP BY s.id, u.full_name, u.email
      `;

      const classQuery = `
        SELECT 
          c.id, 
          c.class_name,
          co.course_name,
          tu.full_name AS teacher_name,
          co.start_date,
          co.end_date
        FROM classes c
        JOIN courses co ON c.course_id = co.id
        JOIN teachers t ON c.teacher_id = t.id
        JOIN users tu ON t.user_id = tu.id
        WHERE co.end_date >= GETDATE()
      `;

      const [enrollment, students, classes] = await Promise.all([
        executeQuery(enrollmentQuery, [id]),
        executeQuery(studentQuery),
        executeQuery(classQuery),
      ]);

      if (!enrollment.length) {
        return res.status(404).send("Enrollment not found");
      }

      res.render("enrollments/editEnrollment", {
        enrollment: enrollment[0],
        students,
        classes,
        user: req.user,
      });
    } catch (err) {
      console.error("Error loading enrollment edit form:", err);
      res.status(500).send("Error loading enrollment edit form");
    }
  }
);

router.get(
  "/enrollments/new",
  checkAuthenticated,
  authenticateRole("admin"),
  async (req, res) => {
    try {
      // Get students with enrollment counts and payment status
      const studentQuery = `
        SELECT 
          s.id, 
          u.full_name, 
          u.email,
          u.phone_number,
          COUNT(e.id) as enrolled_count,
          SUM(CASE WHEN e.payment_status = 0 THEN 1 ELSE 0 END) as unpaid_enrollments
        FROM students s
        JOIN users u ON s.user_id = u.id
        LEFT JOIN enrollments e ON s.id = e.student_id
        GROUP BY 
          s.id, 
          u.full_name, 
          u.email,
          u.phone_number
        ORDER BY u.full_name
      `;

      // Get active classes with detailed info and capacity
      const classQuery = `
        SELECT 
          c.id,
          c.class_name,
          co.course_name,
          co.tuition_fee,
          tu.full_name AS teacher_name,
          co.start_date,
          co.end_date,
          c.weekly_schedule,
          CONVERT(VARCHAR(5), c.start_time, 108) as start_time,
          CONVERT(VARCHAR(5), c.end_time, 108) as end_time,
          (SELECT COUNT(*) FROM enrollments WHERE class_id = c.id) as enrolled_count,
          CASE 
            WHEN co.end_date < GETDATE() THEN 'Ended'
            WHEN co.start_date > GETDATE() THEN 'Upcoming'
            ELSE 'Active'
          END as status
        FROM classes c
        JOIN courses co ON c.course_id = co.id
        JOIN teachers t ON c.teacher_id = t.id
        JOIN users tu ON t.user_id = tu.id
        WHERE co.end_date >= GETDATE()
        ORDER BY co.start_date ASC, c.class_name
      `;

      const [students, classes] = await Promise.all([
        executeQuery(studentQuery),
        executeQuery(classQuery),
      ]);

      // Process class data to include availability info
      const enhancedClasses = classes.map((cls) => ({
        ...cls,
        isAvailable: cls.status !== "Ended",
        schedule: cls.weekly_schedule ? cls.weekly_schedule
          .split(",")
          .map((day) => {
            const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
            return days[parseInt(day) - 1];
          })
          .join(", ") : 'No schedule',
        timeSlot: `${cls.start_time} - ${cls.end_time}`,
      }));

      res.render("enrollments/Addenrollments", {
        students: students.map((s) => ({
          ...s,
          hasUnpaidFees: s.unpaid_enrollments > 0,
        })),
        classes: enhancedClasses,
        user: req.user,
        currentDate: new Date().toISOString().split("T")[0],
        errors: req.flash("error"),
        success: req.flash("success"),
      });
    } catch (err) {
      console.error("Error loading enrollment form:", {
        error: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString(),
      });

      req.flash("error", "Failed to load enrollment form");
      res.status(500).send("Error loading enrollment form");
    }
  }
);

router.post(
  "/enrollments",
  checkAuthenticated,
  authenticateRole("admin"),
  async (req, res) => {
    const { student_id, class_id } = req.body;

    try {
      // 1. Validate input
      if (!student_id || !class_id) {
        return res.status(400).json({
          error: "Missing required fields",
          code: "INVALID_INPUT",
        });
      }

      // 2. Check if student exists
      const studentQuery = "SELECT id FROM students WHERE id = ?";
      const student = await executeQuery(studentQuery, [student_id]);

      if (!student.length) {
        return res.status(404).json({
          error: "Student not found",
          code: "STUDENT_NOT_FOUND",
        });
      }

      // 3. Check if class exists and is active
      const classQuery = `
      SELECT c.id, c.class_name, co.start_date, co.end_date 
      FROM classes c
      JOIN courses co ON c.course_id = co.id
      WHERE c.id = ?`;
      const classInfo = await executeQuery(classQuery, [class_id]);

      if (!classInfo.length) {
        return res.status(404).json({
          error: "Class not found",
          code: "CLASS_NOT_FOUND",
        });
      }

      // 4. Check if enrollment already exists
      const duplicateQuery = `
      SELECT id FROM enrollments 
      WHERE student_id = ? AND class_id = ?`;
      const existing = await executeQuery(duplicateQuery, [
        student_id,
        class_id,
      ]);

      if (existing.length) {
        return res.status(409).json({
          error: "Student already enrolled in this class",
          code: "DUPLICATE_ENROLLMENT",
        });
      }

      // 5. Create enrollment
      const insertQuery = `
      INSERT INTO enrollments (
        student_id, 
        class_id, 
        enrollment_date,
        payment_status,
        updated_at,
        created_at
      )
      VALUES (?, ?, GETDATE(), 0, GETDATE(), GETDATE())
    `;

      await executeQuery(insertQuery, [student_id, class_id]);

      // 6. Add notification for student (use users.id linked from students.user_id)
      const notifyQuery = `
      INSERT INTO notifications (
        user_id,
        message,
        sent_at,
        created_at,
        updated_at
      )
      VALUES ((SELECT user_id FROM students WHERE id = ?), ?, GETDATE(), GETDATE(), GETDATE())
    `;

      await executeQuery(notifyQuery, [
        student_id,
        `You have been enrolled in ${classInfo[0].class_name}`,
      ]);

      req.flash("success", "Enrollment created successfully");
      res.redirect("/enrollments");
    } catch (error) {
      console.error("Enrollment creation error:", {
        error: error.message,
        stack: error.stack,
        student_id,
        class_id,
      });

      req.flash("error", "Failed to create enrollment");
      res.status(500).json({
        error: "Failed to create enrollment",
        code: "CREATE_FAILED",
        message: error.message,
      });
    }
  }
);

router.put(
  "/enrollments/:id",
  checkAuthenticated,
  authenticateRole("admin"),
  async (req, res) => {
    const enrollmentId = req.params.id;
    const { class_id } = req.body;

    try {
      // 1. Validate input
      if (!class_id) {
        req.flash("error", "Class must be selected.");
        return res.redirect(`/enrollments/${enrollmentId}/edit`);
      }

      // 2. Get current enrollment details
      const enrollmentQuery = `
        SELECT e.id, e.student_id, e.class_id, u.full_name as student_name,
               (SELECT class_name FROM classes WHERE id = e.class_id) as old_class_name
        FROM enrollments e
        JOIN students s ON e.student_id = s.id
        JOIN users u ON s.user_id = u.id
        WHERE e.id = ?`;
      const [enrollment] = await executeQuery(enrollmentQuery, [enrollmentId]);

      if (!enrollment) {
        req.flash("error", "Enrollment not found.");
        return res.redirect("/enrollments");
      }

      // 3. Get new class name
      const classQuery = `SELECT class_name FROM classes WHERE id = ?`;
      const [newClass] = await executeQuery(classQuery, [class_id]);

      if (!newClass) {
        req.flash("error", "The selected class does not exist.");
        return res.redirect(`/enrollments/${enrollmentId}/edit`);
      }

      // 4. Update the enrollment
      const updateQuery = `
        UPDATE enrollments
        SET class_id = ?,
            updated_at = GETDATE()
        WHERE id = ?`;
      await executeQuery(updateQuery, [class_id, enrollmentId]);

      // 5. Notify the student of the change
      const notifyQuery = `
        INSERT INTO notifications (user_id, message)
        VALUES ((SELECT user_id FROM students WHERE id = ?), ?)`;
      const message = `Your enrollment has been changed from class '${enrollment.old_class_name}' to '${newClass.class_name}'.`;
      await executeQuery(notifyQuery, [enrollment.student_id, message]);

      req.flash("success", "Enrollment updated successfully.");
      res.redirect("/enrollments");
    } catch (error) {
      console.error("Error updating enrollment:", {
        enrollmentId,
        error: error.message,
        stack: error.stack,
      });
      req.flash("error", "Failed to update enrollment.");
      res.redirect(`/enrollments/${enrollmentId}/edit`);
    }
  }
);

module.exports = router;
