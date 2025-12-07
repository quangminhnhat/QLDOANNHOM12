const express = require("express");
const sql = require("msnodesqlv8");
const { authenticateRole } = require("../middleware/roleAuth");
const connectionString = process.env.CONNECTION_STRING; 
const executeQuery = require("../middleware/executeQuery");
const {
  checkAuthenticated,
} = require("../middleware/auth");
const router = express.Router();
const validateSchedule = require("../middleware/validateSchedule");

// Helper: check if a column exists in a table (SQL Server)
async function columnExists(tableName, columnName) {
  try {
    const q = `
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = ? AND COLUMN_NAME = ?
    `;
    const rows = await executeQuery(q, [tableName, columnName]);
    return rows && rows.length > 0;
  } catch (err) {
    console.error('Failed to check column existence:', err);
    return false;
  }
}




router.get(
  "/schedule/new",
  checkAuthenticated,
  authenticateRole("admin"),
  async (req, res) => {
    try {
      const query = `
        SELECT 
          c.id,
          c.class_name,
          c.course_id,
          c.teacher_id,
          CONVERT(varchar(5), c.start_time, 108) as start_time,
          CONVERT(varchar(5), c.end_time, 108) as end_time,
          c.weekly_schedule,
          co.course_name,
          CONVERT(varchar(10), co.start_date, 23) as start_date,
          CONVERT(varchar(10), co.end_date, 23) as end_date,
          tu.full_name as teacher_name
        FROM classes c
        INNER JOIN courses co ON c.course_id = co.id
        INNER JOIN teachers t ON c.teacher_id = t.id
        INNER JOIN users tu ON t.user_id = tu.id
        WHERE co.end_date >= GETDATE()
        ORDER BY co.start_date ASC, c.class_name
      `;

      let classes = await executeQuery(query);

      // Process weekly schedule for display
      const processedClasses = classes.map((cls) => ({
        ...cls,
        formattedStartTime: cls.start_time,
        formattedEndTime: cls.end_time,
        schedule: cls.weekly_schedule
          ? cls.weekly_schedule
              .split(",")
              .map((day) => {
                const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
                return days[parseInt(day) - 1];
              })
              .join(", ")
          : "No schedule set",
      }));

      res.render("Schedule/newSchedule", {
        classes: processedClasses,
        user: req.user,
        currentDate: new Date().toISOString().split("T")[0],
      });
    } catch (err) {
      console.error("Error loading schedule form:", err);
      console.error(err.stack);
      res.status(500).send("Error loading schedule form");
    }
  }
);








router.delete(
  "/schedules/:id",
  checkAuthenticated,
  authenticateRole("admin"),
  async (req, res) => {
    try {
      const scheduleId = req.params.id;
      
      // Check if schedule exists
      const checkQuery = "SELECT id FROM schedules WHERE id = ?";
      const schedule = await executeQuery(checkQuery, [scheduleId]);
      
      if (!schedule.length) {
        return res.status(404).send("Schedule not found");
      }

      // Delete schedule
      const deleteQuery = "DELETE FROM schedules WHERE id = ?";
      await executeQuery(deleteQuery, [scheduleId]);
      
      res.redirect("/schedules");
    } catch (err) {
      console.error("Delete schedule error:", err);
      res.status(500).send("Failed to delete schedule");
    }
  }
);



router.get(
  "/schedules",
  checkAuthenticated,
  authenticateRole("admin"),
  async (req, res) => {
    try {
      const query = `
      SELECT 
        s.*,
        c.class_name,
        co.course_name,
        tu.full_name as teacher_name,
        CONVERT(VARCHAR(5), s.start_time, 108) as formatted_start_time,
        CONVERT(VARCHAR(5), s.end_time, 108) as formatted_end_time
      FROM schedules s
      JOIN classes c ON s.class_id = c.id
      JOIN courses co ON c.course_id = co.id
      JOIN teachers t ON c.teacher_id = t.id
      JOIN users tu ON t.user_id = tu.id
      ORDER BY s.schedule_date DESC, s.start_time ASC
    `;

      const schedules = await executeQuery(query);
      res.render("Schedule/schedules", { schedules, user: req.user });
    } catch (err) {
      console.error("Fetch schedules error:", err);
      res.status(500).send("Error loading schedules");
    }
  }
);



router.post(
  "/schedules",
  checkAuthenticated,
  authenticateRole("admin"),
  async (req, res) => {
    try {
      const { class_id, schedule_date, start_time, end_time, day_of_week } =
        req.body;

      // Input validation
      if (
        !class_id ||
        !schedule_date ||
        !start_time ||
        !end_time ||
        !day_of_week
      ) {
        return res.status(400).send("Missing required fields");
      }

      // Check for schedule conflicts
      const conflictQuery = `
      SELECT id FROM schedules 
      WHERE class_id = ? 
      AND schedule_date = ? 
      AND ((start_time <= ? AND end_time >= ?) 
        OR (start_time <= ? AND end_time >= ?)
        OR (start_time >= ? AND end_time <= ?))
    `;

      const conflicts = await executeQuery(conflictQuery, [
        class_id,
        schedule_date,
        start_time,
        start_time,
        end_time,
        end_time,
        start_time,
        end_time,
      ]);

      if (conflicts.length > 0) {
        return res.status(409).send("Schedule conflict detected");
      }

      // Adapt insert depending on whether `schedules.course_id` exists
      const hasCourseCol = await columnExists('schedules', 'course_id');

      if (hasCourseCol) {
        // Retrieve course_id from classes table and include it in the insert
        const courseQuery = "SELECT course_id FROM classes WHERE id = ?";
        const courseResult = await executeQuery(courseQuery, [class_id]);
        if (!courseResult.length) return res.status(404).send('Class not found');
        const course_id = courseResult[0].course_id;

        const insertQuery = `
        INSERT INTO schedules (
          class_id,
          course_id,
          day_of_week,
          schedule_date,
          start_time,
          end_time,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())`;

        await executeQuery(insertQuery, [
          class_id,
          course_id,
          day_of_week,
          schedule_date,
          start_time,
          end_time,
        ]);
      } else {
        const insertQuery = `
        INSERT INTO schedules (
          class_id,
          day_of_week,
          schedule_date,
          start_time,
          end_time,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, GETDATE(), GETDATE())`;

        await executeQuery(insertQuery, [
          class_id,
          day_of_week,
          schedule_date,
          start_time,
          end_time,
        ]);
      }

      res.redirect("/schedules");
    } catch (err) {
      console.error("Create schedule error:", err);
      res.status(500).send("Failed to create schedule");
    }
  }
);


router.get("/schedules/:id/edit", checkAuthenticated, authenticateRole("admin"), async (req, res) => {
  try {
    const scheduleId = req.params.id;

    // Get schedule details with all related information
    const scheduleQuery = `
      SELECT 
        s.*,
        c.id as class_id,
        c.class_name,
        c.weekly_schedule,
        co.id as course_id,
        co.course_name,
        co.start_date as course_start,
        co.end_date as course_end,
        tu.full_name as teacher_name,
        CONVERT(varchar(5), s.start_time, 108) as formatted_start_time,
        CONVERT(varchar(5), s.end_time, 108) as formatted_end_time,
        CONVERT(varchar(10), s.schedule_date, 23) as formatted_schedule_date
      FROM schedules s
      JOIN classes c ON s.class_id = c.id
      JOIN courses co ON c.course_id = co.id
      JOIN teachers t ON c.teacher_id = t.id
      JOIN users tu ON t.user_id = tu.id
      WHERE s.id = ?
    `;

    // Get all available classes for dropdown
    const classesQuery = `
      SELECT 
        c.id,
        c.class_name,
        co.course_name,
        tu.full_name as teacher_name,
        CONVERT(varchar(10), co.start_date, 23) as start_date,
        CONVERT(varchar(10), co.end_date, 23) as end_date,
        c.weekly_schedule
      FROM classes c
      JOIN courses co ON c.course_id = co.id
      JOIN teachers t ON c.teacher_id = t.id
      JOIN users tu ON t.user_id = tu.id
      WHERE co.end_date >= GETDATE()
      ORDER BY co.start_date ASC, c.class_name
    `;

    // Execute both queries concurrently
    const [scheduleResults, classesResults] = await Promise.all([
      executeQuery(scheduleQuery, [scheduleId]),
      executeQuery(classesQuery)
    ]);

    if (!scheduleResults.length) {
      console.error(`Schedule not found with ID: ${scheduleId}`);
      return res.status(404).render('error.ejs', {
        message: 'Schedule not found',
        user: req.user
      });
    }

    // Process weekly schedule for classes
    const processedClasses = classesResults.map(cls => ({
      ...cls,
      schedule: cls.weekly_schedule ? 
        cls.weekly_schedule.split(',')
          .map(day => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][parseInt(day) - 1])
          .join(', ') : 
        'No schedule set'
    }));

    res.render("Schedule/editSchedule", {
      schedule: {
        ...scheduleResults[0],
        day_name: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][
          new Date(scheduleResults[0].schedule_date).getDay()
        ]
      },
      classes: processedClasses,
      user: req.user,
      messages: {
        error: req.flash('error'),
        success: req.flash('success')
      }
    });

  } catch (err) {
    console.error("Schedule edit error:", err);
    res.status(500).render('error.ejs', {
      message: 'Error loading schedule edit form',
      error: err,
      user: req.user
    });
  }
});




//you gonna need to redo this part
router.get("/schedule", checkAuthenticated, (req, res) => {
    // 1. Week calculation
    let monday;
    if (req.query.weekStart) {
      monday = new Date(req.query.weekStart);
    } else {
      const today = new Date();
      const offset = (today.getDay() + 6) % 7; // Mon = 0
      monday = new Date(today);
      monday.setDate(today.getDate() - offset);
    }
  
    // 2. Days setup
    const dayNames = [
      "Thứ 2",
      "Thứ 3",
      "Thứ 4",
      "Thứ 5",
      "Thứ 6",
      "Thứ 7",
      "Chủ nhật",
    ];
    const days = Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(monday);
      dt.setDate(monday.getDate() + i);
      return {
        name: dayNames[i],
        date: dt.toLocaleDateString("vi-VN"),
        iso: dt.toISOString().slice(0, 10),
      };
    });
  
    // 3. Query based on user role
    const userId = req.user.id;
    const role = req.user.role;
  
    let query;
    let params = [];
  
    if (role === "student") {
        query = `
          SELECT 
            cls.id as class_id,
            cls.class_name,
            co.course_name,
            tu.full_name AS teacher,
            CONVERT(VARCHAR(5), cls.start_time, 108) as start_time,
            CONVERT(VARCHAR(5), cls.end_time, 108) as end_time,
            cls.weekly_schedule,
            s.schedule_date AS extra_date,
            s.start_time AS extra_start,
            s.end_time AS extra_end,
            co.start_date AS course_start,
            co.end_date AS course_end 
          FROM students st
          JOIN enrollments e ON st.id = e.student_id
          JOIN classes cls ON e.class_id = cls.id
          JOIN courses co ON cls.course_id = co.id
          JOIN teachers t ON cls.teacher_id = t.id
          JOIN users tu ON t.user_id = tu.id
          LEFT JOIN schedules s ON cls.id = s.class_id 
            AND s.schedule_date BETWEEN ? AND ?
          WHERE st.user_id = ?
            AND co.start_date <= ?  -- Thêm điều kiện này
            AND co.end_date >= ?    -- Thêm điều kiện này
        `;
        params = [days[0].iso, days[6].iso, userId, days[6].iso, days[0].iso]; 
    } else if (role === "teacher") {
      query = `
        SELECT 
          cls.id as class_id,
          cls.class_name,
          co.course_name,
          tu.full_name AS teacher,
          CONVERT(VARCHAR(5), cls.start_time, 108) as start_time,
          CONVERT(VARCHAR(5), cls.end_time, 108) as end_time,
          cls.weekly_schedule,
          s.schedule_date AS extra_date,
          s.start_time AS extra_start,
          s.end_time AS extra_end,
          co.start_date AS course_start,
          co.end_date AS course_end
        FROM teachers t
        JOIN classes cls ON t.id = cls.teacher_id
        JOIN courses co ON cls.course_id = co.id
        JOIN users tu ON t.user_id = tu.id
        LEFT JOIN schedules s ON cls.id = s.class_id 
          AND s.schedule_date BETWEEN ? AND ?
        WHERE t.user_id = ?
          AND co.start_date <= ?
          AND co.end_date >= ?
      `;
      params = [days[0].iso, days[6].iso, userId, days[6].iso, days[0].iso];
    } else {
      return res.status(403).send("Unauthorized role");
    }
  
    sql.query(connectionString, query, params, (err, rows) => {
      if (err) {
        console.error("SQL Error Details:", {
          error: err.message,
          code: err.code,
          query: query,
          params: params,
        });
        return res.status(500).send("Database operation failed");
      }
  
      const scheduleData = [];
      const periodMap = {}; // To track which periods are already filled
  
      // Helper function to convert time string to period number
      const timeToPeriod = (timeValue) => {
        // Xử lý cả Date object và string
        let hours, minutes;
        if (timeValue instanceof Date) {
          hours = timeValue.getHours();
          minutes = timeValue.getMinutes();
        } else if (typeof timeValue === "string") {
          [hours, minutes] = timeValue.split(":").map(Number);
        } else {
          // Fallback nếu có kiểu dữ liệu khác
          const timeStr = timeValue.toString();
          [hours, minutes] = timeStr.split(":").map(Number);
        }
  
        // Tính toán period dựa trên giờ bắt đầu là 7:00
        return Math.floor(hours - 7 + minutes / 60) + 1;
      };
      // Trong phần xử lý kết quả query
      const courseStart = rows.length > 0 ? rows[0].course_start : null;
      const courseEnd = rows.length > 0 ? rows[0].course_end : null;
  
      // Process regular weekly classes
      rows.forEach((row) => {
        if (row.weekly_schedule) {
          const weekDays = row.weekly_schedule.split(",").map(Number);
  
          weekDays.forEach((dayIndex) => {
            if (dayIndex >= 1 && dayIndex <= 7) {
              const startPeriod = timeToPeriod(row.start_time);
              const endPeriod = timeToPeriod(row.end_time);
              const dayIso = days[dayIndex - 1].iso; // Lấy ngày ISO tương ứng
  
              // Thêm từng tiết học vào scheduleData
              for (let period = startPeriod; period <= endPeriod; period++) {
                scheduleData.push({
                  type: "regular",
                  date: dayIso,
                  startPeriod: period,
                  endPeriod: period,
                  className: row.class_name,
                  courseName: row.course_name,
                  teacher: row.teacher || "",
                  classId: row.class_id,
                });
              }
            }
          });
        }
  
        // Process extra sessions
        if (row.extra_date) {
          const extraDate = new Date(row.extra_date).toISOString().slice(0, 10);
          const startPeriod = timeToPeriod(row.extra_start);
          const endPeriod = timeToPeriod(row.extra_end);
  
          for (let period = startPeriod; period <= endPeriod; period++) {
            const key = `${extraDate}-${period}`;
  
            if (!periodMap[key]) {
              scheduleData.push({
                type: "extra",
                date: extraDate,
                startPeriod: period,
                endPeriod: period,
                className: row.class_name,
                courseName: row.course_name,
                teacher: row.teacher || "",
                classId: row.class_id,
              });
              periodMap[key] = true;
            }
          }
        }
      });
      
  
      res.render("schedule", {
        user: req.user,
        days,
        scheduleData,
        courseStart, 
        courseEnd, 
        weekStart: days[0].iso,
        prevWeekStart: new Date(new Date(monday).setDate(monday.getDate() - 7))
          .toISOString()
          .slice(0, 10),
        nextWeekStart: new Date(new Date(monday).setDate(monday.getDate() + 7))
          .toISOString()
          .slice(0, 10),
      });
    });
  });




  router.post(
    "/schedules/:id",
    checkAuthenticated,
    authenticateRole("admin"),
    async (req, res) => {
      try {
        const scheduleId = req.params.id;
        const { class_id, schedule_date, start_time, end_time, day_of_week } =
          req.body;

        // Debug log
        console.log("Received data:", {
          scheduleId,
          class_id,
          schedule_date,
          start_time,
          end_time,
          day_of_week,
        });

        // Input validation with specific error messages
        const missingFields = [];
        if (!class_id) missingFields.push("Class");
        if (!schedule_date) missingFields.push("Schedule date");
        if (!start_time) missingFields.push("Start time");
        if (!end_time) missingFields.push("End time");
        if (!day_of_week) missingFields.push("Day of week");

        if (missingFields.length > 0) {
          req.flash(
            "error",
            `Missing required fields: ${missingFields.join(", ")}`
          );
          return res.redirect(`/schedules/${scheduleId}/edit`);
        }

        // Update schedule. Include course_id if that column exists in the DB.
        const hasCourseCol = await columnExists('schedules', 'course_id');

        if (hasCourseCol) {
          const courseQuery = "SELECT course_id FROM classes WHERE id = ?";
          const courseResult = await executeQuery(courseQuery, [class_id]);
          if (!courseResult.length) {
            req.flash('error', 'Class not found');
            return res.redirect(`/schedules/${scheduleId}/edit`);
          }
          const course_id = courseResult[0].course_id;

          const updateQuery = `
          UPDATE schedules 
          SET class_id = ?,
              course_id = ?,
              day_of_week = ?,
              schedule_date = ?,
              start_time = ?,
              end_time = ?,
              updated_at = GETDATE()
          WHERE id = ?`;

          await executeQuery(updateQuery, [
            class_id,
            course_id,
            day_of_week,
            schedule_date,
            start_time,
            end_time,
            scheduleId,
          ]);
        } else {
          const updateQuery = `
          UPDATE schedules 
          SET class_id = ?,
              day_of_week = ?,
              schedule_date = ?,
              start_time = ?,
              end_time = ?,
              updated_at = GETDATE()
          WHERE id = ?`;

          await executeQuery(updateQuery, [
            class_id,
            day_of_week,
            schedule_date,
            start_time,
            end_time,
            scheduleId,
          ]);
        }

        req.flash("success", "Schedule updated successfully");
        res.redirect("/schedules");
      } catch (err) {
        console.error("Update schedule error:", err);
        req.flash("error", "Failed to update schedule");
        res.redirect(`/schedules/${req.params.id}/edit`);
      }
    }
  );


  router.get(
    "/schedules/new",
    checkAuthenticated,
    authenticateRole("admin"),
    async (req, res) => {
      try {
        // Get active classes with course and teacher info
        const query = `
        SELECT 
          c.id,
          c.class_name,
          co.id as course_id, 
          co.course_name,
          tu.full_name as teacher_name,
          co.start_date,
          co.end_date
        FROM classes c
        JOIN courses co ON c.course_id = co.id
        JOIN teachers t ON c.teacher_id = t.id
        JOIN users tu ON t.user_id = tu.id
        WHERE co.end_date >= GETDATE()
        ORDER BY co.start_date ASC, c.class_name
      `;

        const classes = await executeQuery(query);

        res.render("Schedule/newSchedule", {
          user: req.user,
          classes: classes,
          currentDate: new Date().toISOString().split("T")[0],
        });
      } catch (err) {
        console.error("Error loading schedule form:", err);
        res.status(500).send("Error loading schedule form");
      }
    }
  );

  router.delete(
    "/schedules/:id",
    checkAuthenticated,
    authenticateRole("admin"),
    async (req, res) => {
      try {
        const scheduleId = req.params.id;

        // Check if schedule exists
        const checkQuery = "SELECT id FROM schedules WHERE id = ?";
        const schedule = await executeQuery(checkQuery, [scheduleId]);

        if (!schedule.length) {
          return res.status(404).send("Schedule not found");
        }

        // Delete schedule
        await executeQuery("DELETE FROM schedules WHERE id = ?", [scheduleId]);

        res.redirect("/schedules");
      } catch (err) {
        console.error("Delete schedule error:", err);
        res.status(500).send("Failed to delete schedule");
      }
    }
  );

  module.exports = router;