const express = require("express");
const sql = require("msnodesqlv8");
const { authenticateRole } = require("../middleware/roleAuth");
const connectionString = process.env.CONNECTION_STRING; 
const executeQuery = require("../middleware/executeQuery");
const {
  checkAuthenticated,
} = require("../middleware/auth");
const router = express.Router();


router.get(
  "/classes",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      const query = `
      SELECT 
        c.id, 
        c.class_name,
        c.weekly_schedule,
        co.course_name,
        u.full_name AS teacher_name,
        CONVERT(VARCHAR(5), c.start_time, 108) as formatted_start_time,
        CONVERT(VARCHAR(5), c.end_time, 108) as formatted_end_time,
        (SELECT COUNT(*) FROM enrollments WHERE class_id = c.id) as student_count
      FROM classes c
      JOIN courses co ON c.course_id = co.id
      JOIN teachers t ON c.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      ORDER BY c.created_at DESC
    `;

      const classes = await executeQuery(query);

      // Process weekly schedule for display
      classes.forEach((cls) => {
        if (cls.weekly_schedule) {
          const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
          cls.scheduleDisplay = cls.weekly_schedule
            .split(",")
            .map((day) => days[parseInt(day) - 1])
            .join(", ");
        } else {
          cls.scheduleDisplay = "No schedule set";
        }
      });

      res.render("class/classes", { classes, user: req.user });
    } catch (err) {
      console.error("Fetch classes error:", err);
      res.status(500).send("Error loading classes");
    }
  }
);


router.post(
  "/classes/:id",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      const {
        class_name,
        course_id,
        teacher_id,
        start_time,
        end_time,
        weekly_days,
      } = req.body;
      const classId = req.params.id;

      // Input validation
      if (
        !class_name ||
        !course_id ||
        !teacher_id ||
        !start_time ||
        !end_time ||
        !weekly_days
      ) {
        return res.status(400).send("Missing required fields");
      }

      // Convert weekly_days array to comma-separated string
      const weekly_schedule = Array.isArray(weekly_days)
        ? weekly_days.join(",")
        : weekly_days;

      const updateQuery = `
      UPDATE classes 
      SET class_name = ?,
          course_id = ?,
          teacher_id = ?,
          start_time = ?,
          end_time = ?,
          weekly_schedule = ?,
          updated_at = GETDATE()
      WHERE id = ?
    `;

      await executeQuery(updateQuery, [
        class_name,
        course_id,
        teacher_id,
        start_time,
        end_time,
        weekly_schedule,
        classId,
      ]);

      res.redirect("/classes");
    } catch (error) {
      console.error("Error updating class:", error);
      res.status(500).send("Failed to update class");
    }
  }
);


router.get(
  "/classes/:id/edit",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      const classId = req.params.id;
      // Lấy thông tin lớp học
      const classQuery = `
        SELECT 
          c.*, 
          CONVERT(varchar(5), c.start_time, 108) as formatted_start_time,
          CONVERT(varchar(5), c.end_time, 108) as formatted_end_time
        FROM classes c
        WHERE c.id = ?
      `;
      // Lấy danh sách khóa học
      const courseQuery = `SELECT id, course_name FROM courses ORDER BY course_name`;
      // Lấy danh sách giáo viên
      const teacherQuery = `
        SELECT t.id, u.full_name 
        FROM teachers t
        JOIN users u ON t.user_id = u.id
        ORDER BY u.full_name`;

      const [classResult, courses, teachers] = await Promise.all([
        executeQuery(classQuery, [classId]),
        executeQuery(courseQuery),
        executeQuery(teacherQuery),
      ]);

      if (!classResult.length) {
        return res.status(404).send("Class not found");
      }

      // Đổi tên trường cho EJS
      const classItem = {
        ...classResult[0],
        course_id: classResult[0].course_id,
        teacher_id: classResult[0].teacher_id,
        class_name: classResult[0].class_name,
        formatted_start_time: classResult[0].formatted_start_time,
        formatted_end_time: classResult[0].formatted_end_time,
        weekly_schedule: classResult[0].weekly_schedule,
      };

      // Đổi tên trường cho EJS dropdown
      const courseList = courses.map(c => ({
        id: c.id,
        name: c.course_name
      }));
      const teacherList = teachers.map(t => ({
        id: t.id,
        name: t.full_name
      }));

      res.render("class/editClass.ejs", {
        user: req.user,
        classItem,
        courses: courseList,
        teachers: teacherList,
      });
    } catch (error) {
      console.error("Error loading class edit form:", error);
      res.status(500).send("Error loading class edit form");
    }
  }
);

router.delete(
  "/classes/:id",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      const classId = req.params.id;

      // Check if class exists and get related info
      const checkQuery = `
        SELECT c.id, c.class_name, COUNT(e.id) as enrollment_count
        FROM classes c
        LEFT JOIN enrollments e ON c.id = e.class_id
        WHERE c.id = ?
        GROUP BY c.id, c.class_name
      `;

      const classInfo = await executeQuery(checkQuery, [classId]);

      if (!classInfo.length) {
        return res.status(404).json({
          error: "Class not found",
          code: "CLASS_NOT_FOUND",
        });
      }

      // Check for existing enrollments
      if (classInfo[0].enrollment_count > 0) {
        return res.status(400).json({
          error: "Cannot delete class with active enrollments",
          code: "HAS_ENROLLMENTS",
          details: {
            className: classInfo[0].class_name,
            enrollmentCount: classInfo[0].enrollment_count,
          },
        });
      }

      // First delete related schedules
      await executeQuery("DELETE FROM schedules WHERE class_id = ?", [classId]);

      // Then delete the class
      await executeQuery("DELETE FROM classes WHERE id = ?", [classId]);

      // Send success response
      res.redirect("/classes");
    } catch (error) {
      console.error("Class deletion error:", {
        classId: req.params.id,
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        error: "Failed to delete class",
        code: "DELETE_FAILED",
        message: error.message,
      });
    }
  }
);


router.post(
  "/classes",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      const {
        class_name,
        course_id,
        teacher_id,
        start_time,
        end_time,
        weekly_days,
      } = req.body;

      // Input validation
      if (
        !class_name ||
        !course_id ||
        !teacher_id ||
        !start_time ||
        !end_time ||
        !weekly_days
      ) {
        req.flash("error", "Missing required fields");
        return res.redirect("/classes/new");
      }

      // Convert weekly_days array to comma-separated string
      const weekly_schedule = Array.isArray(weekly_days)
        ? weekly_days.join(",")
        : weekly_days;

      // Validate course dates
      const courseQuery = `
      SELECT start_date, end_date 
      FROM courses 
      WHERE id = ?
    `;
      const courseResult = await executeQuery(courseQuery, [course_id]);

      if (!courseResult.length) {
        req.flash("error", "Course not found");
        return res.redirect("/classes/new");
      }

      // Check for teacher schedule conflicts (time and day)
      const conflictQuery = `
        SELECT c.class_name, c.weekly_schedule,
               CONVERT(VARCHAR(5), c.start_time, 108) as start_time,
               CONVERT(VARCHAR(5), c.end_time, 108) as end_time
        FROM classes c
        WHERE c.teacher_id = ?
          AND c.start_time < ? -- Existing class starts before new one ends
          AND c.end_time > ?   -- Existing class ends after new one starts
      `;
      const potentialConflicts = await executeQuery(conflictQuery, [teacher_id, end_time, start_time]);

      const newDays = Array.isArray(weekly_days) ? weekly_days.map(String) : [String(weekly_days)];
      const teacherConflicts = potentialConflicts.filter(existingClass => {
          if (!existingClass.weekly_schedule) return false;
          const existingDays = existingClass.weekly_schedule.split(',');
          // Check if there is any overlap in days
          return newDays.some(newDay => existingDays.includes(newDay));
      });

      if (teacherConflicts.length > 0) {
        req.flash(
          "error",
          `Schedule Conflict: The selected teacher is already assigned to another class during the chosen time and day. Conflicting class: ${teacherConflicts[0].class_name}`
        );
        return res.redirect("/classes/new");
      }

      const query = `
      INSERT INTO classes (
        class_name, 
        course_id, 
        teacher_id, 
        start_time, 
        end_time, 
        weekly_schedule,
        created_at, 
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
    `;

      await executeQuery(query, [
        class_name,
        course_id,
        teacher_id,
        start_time,
        end_time,
        weekly_schedule,
      ]);

      req.flash("success", "Class created successfully");
      res.redirect("/classes");
    } catch (err) {
      console.error("Create class error:", err);
      req.flash("error", "Failed to create class");
      res.redirect("/classes/new");
    }
  }
);

router.get(
  "/classes/new",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      // Get courses and teachers data
      const courseQuery = "SELECT id, course_name FROM courses ORDER BY course_name";
      const teacherQuery = `
        SELECT t.id, u.full_name 
        FROM teachers t
        JOIN users u ON t.user_id = u.id
        ORDER BY u.full_name
      `;

      const [courses, teachers] = await Promise.all([
        executeQuery(courseQuery),
        executeQuery(teacherQuery),
      ]);

      // Render with both courses and teachers data
        res.render("class/addClass", {
          user: req.user,
          courses: courses,
          teachers: teachers,
          messages: {
            error: req.flash("error"),
            success: req.flash("success"),
          },
        });
    } catch (err) {
      console.error("Error loading new class form:", err);
      res.status(500).send("Error loading form data");
    }
  }
);

router.get(
  "/classes/:id/students",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      const classId = req.params.id;

      // Query to get class details
      const classQuery = `
        SELECT 
          c.id, 
          c.class_name,
          co.course_name,
          u.full_name AS teacher_name
        FROM classes c
        JOIN courses co ON c.course_id = co.id
        JOIN teachers t ON c.teacher_id = t.id
        JOIN users u ON t.user_id = u.id
        WHERE c.id = ?
      `;
      const classInfo = await executeQuery(classQuery, [classId]);

      if (!classInfo.length) {
        req.flash("error", "Class not found.");
        return res.redirect("/classes");
      }

      // Query to get enrolled students
      const studentsQuery = `
        SELECT 
          u.full_name,
          u.email,
          u.phone_number,
          e.enrollment_date,
          e.payment_status,
          e.payment_date
        FROM enrollments e
        JOIN students s ON e.student_id = s.id
        JOIN users u ON s.user_id = u.id
        WHERE e.class_id = ?
        ORDER BY u.full_name
      `;
      const students = await executeQuery(studentsQuery, [classId]);

      res.render("class/classStudents", {
        user: req.user,
        classInfo: classInfo[0],
        students: students,
      });
    } catch (error) {
      console.error("Error fetching class students:", error);
      req.flash("error", "Failed to load student list.");
      res.redirect("/classes");
    }
  }
);

module.exports = router;