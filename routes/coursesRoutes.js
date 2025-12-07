const express = require("express");
const path = require("path");
const sql = require("msnodesqlv8");
const { authenticateRole } = require("../middleware/roleAuth");
const fs = require("fs");
const connectionString = process.env.CONNECTION_STRING; 
const courseImageUpload = require("../middleware/courseImageUpload");
const executeQuery = require("../middleware/executeQuery");
const {
  checkAuthenticated,
} = require("../middleware/auth");
const router = express.Router();


router.get("/course-detail/:id", async (req, res) => {
  try {
    const courseId = req.params.id;
    const query = `
      SELECT 
        id,
        course_name,
        description,
        image_path
      FROM courses
      WHERE id = ?
    `;
    const [course] = await executeQuery(query, [courseId]);

    if (!course) {
      return res.status(404).render("error", {
        message: "Course not found.",
        user: req.user,
      });
    }

    res.render("courses/course-detail", { course, user: req.user });
  } catch (error) {
    console.error("Error fetching public course details:", error);
    res.status(500).send("Error loading course details");
  }
});




router.get(
  "/courses/new",
  checkAuthenticated,
  authenticateRole("admin"),
  (req, res) => {
    res.render("courses/addCourse", { user: req.user });
  }
);


router.delete(
  "/courses/:id",
  checkAuthenticated,
  authenticateRole("admin"),
  async (req, res) => {
    try {
      const courseId = req.params.id;

      // Check if course has any classes
      const classCheckQuery = `
      SELECT COUNT(*) as classCount 
      FROM classes 
      WHERE course_id = ?
    `;
      const classCheck = await executeQuery(classCheckQuery, [courseId]);

      if (classCheck[0].classCount > 0) {
        req.flash("error", "Cannot delete course that has classes");
        return res.redirect("/courses");
      }

      // Check if course has any materials
      const materialCheckQuery = `
      SELECT COUNT(*) as materialCount 
      FROM materials 
      WHERE course_id = ?
    `;
      const materialCheck = await executeQuery(materialCheckQuery, [courseId]);

      if (materialCheck[0].materialCount > 0) {
        req.flash("error", "Cannot delete course that has materials");
        return res.redirect("/courses");
      }

      // If no dependencies, delete the course
      const deleteQuery = `DELETE FROM courses WHERE id = ?`;
      await executeQuery(deleteQuery, [courseId]);

      req.flash("success", "Course deleted successfully");
      res.redirect("/courses");
    } catch (error) {
      console.error("Course deletion error:", error);
      req.flash("error", "Failed to delete course");
      res.redirect("/courses");
    }
  }
);


router.get("/courses/:id", checkAuthenticated, authenticateRole(["admin", "teacher"]), async (req, res) => {
  try {
    const courseId = req.params.id;
    
    // Get course details with class and material counts
    const query = `
      SELECT 
        c.*,
        CONVERT(varchar(10), c.start_date, 23) as formatted_start_date,
        CONVERT(varchar(10), c.end_date, 23) as formatted_end_date,
        (SELECT COUNT(*) FROM classes WHERE course_id = c.id) as class_count,
        (SELECT COUNT(*) FROM materials WHERE course_id = c.id) as material_count,
        (
          SELECT STRING_AGG(CONCAT(u.full_name, ' (', cls.class_name, ')'), ', ')
          FROM classes cls
          JOIN teachers t ON cls.teacher_id = t.id
          JOIN users u ON t.user_id = u.id
          WHERE cls.course_id = c.id
        ) as teachers_and_classes
      FROM courses c
      WHERE c.id = ?
    `;

    const courseResult = await executeQuery(query, [courseId]);

    if (!courseResult.length) {
      return res.status(404).send("Course not found");
    }

    // Get all classes for this course
    const classesQuery = `
      SELECT 
        cls.id,
        cls.class_name,
        u.full_name as teacher_name,
        CONVERT(varchar(5), cls.start_time, 108) as start_time,
        CONVERT(varchar(5), cls.end_time, 108) as end_time,
        cls.weekly_schedule,
        (SELECT COUNT(*) FROM enrollments WHERE class_id = cls.id) as student_count
      FROM classes cls
      JOIN teachers t ON cls.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      WHERE cls.course_id = ?
      ORDER BY cls.class_name
    `;

    const classesResult = await executeQuery(classesQuery, [courseId]);

    // Get all materials for this course
    const materialsQuery = `
      SELECT id, file_name, uploaded_at
      FROM materials
      WHERE course_id = ?
      ORDER BY uploaded_at DESC
    `;

    const materialsResult = await executeQuery(materialsQuery, [courseId]);

    // Process the course data
    const course = {
      ...courseResult[0],
      classes: classesResult.map(cls => ({
        ...cls,
        schedule: cls.weekly_schedule ? 
          cls.weekly_schedule.split(',')
            .map(day => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][parseInt(day) - 1])
            .join(', ') : 
          'No schedule set'
      })),
      materials: materialsResult
    };

    res.render("courses/courseDetail", {
      course,
      user: req.user,
      messages: {
        error: req.flash('error'),
        success: req.flash('success')
      }
    });

  } catch (error) {
    console.error("Error fetching course details:", error);
    res.status(500).send("Error loading course details");
  }
});


router.get("/courses/:id/edit", checkAuthenticated, authenticateRole("admin"), async (req, res) => {
  try {
    const courseId = req.params.id;
    
    // Get course details
    const query = `
      SELECT 
        c.*,
        CONVERT(varchar(10), c.start_date, 23) as formatted_start_date,
        CONVERT(varchar(10), c.end_date, 23) as formatted_end_date,
        (SELECT COUNT(*) FROM classes WHERE course_id = c.id) as class_count,
        (SELECT COUNT(*) FROM materials WHERE course_id = c.id) as material_count,
        (
          SELECT STRING_AGG(CONCAT(u.full_name, ' (', cls.class_name, ')'), ', ') 
          FROM classes cls
          JOIN teachers t ON cls.teacher_id = t.id
          JOIN users u ON t.user_id = u.id
          WHERE cls.course_id = c.id
        ) as teachers_and_classes
      FROM courses c
      WHERE c.id = ?
    `;

    const courseResult = await executeQuery(query, [courseId]);

    if (!courseResult.length) {
      return res.status(404).send("Course not found");
    }

    const course = {
      ...courseResult[0],
      start_date: new Date(courseResult[0].start_date),
      end_date: new Date(courseResult[0].end_date)
    };

    res.render("courses/editCourse", {
      course,
      user: req.user,
      messages: {
        error: req.flash('error'),
        success: req.flash('success')
      }
    });

  } catch (error) {
    console.error("Error loading course edit form:", error);
    res.status(500).send("Error loading course edit form");
  }
});

router.get(
  "/courses",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      const query = `
      SELECT 
        c.*,
        (SELECT COUNT(*) FROM classes WHERE course_id = c.id) as class_count,
        (SELECT COUNT(*) FROM materials WHERE course_id = c.id) as material_count,
        (
          SELECT STRING_AGG(CONCAT(u.full_name, ' (', cls.class_name, ')'), ', ')
          FROM classes cls
          JOIN teachers t ON cls.teacher_id = t.id
          JOIN users u ON t.user_id = u.id
          WHERE cls.course_id = c.id
        ) as teachers_and_classes
      FROM courses c
      ORDER BY c.created_at DESC
    `;

      const courses = await executeQuery(query);

      // Process the results
      const processedCourses = courses.map((course) => ({
        ...course,
        hasClasses: course.class_count > 0,
        teacherInfo: course.teachers_and_classes || "No classes assigned",
      }));

      res.render("courses/courses", {
        courses: processedCourses,
        user: req.user,
      });
    } catch (err) {
      console.error("Fetch courses error:", err);
      res.status(500).send("Error loading courses");
    }
  }
);

router.post("/courses", 
  checkAuthenticated, 
  authenticateRole("admin"),
  courseImageUpload.single('course_image'),
  async (req, res) => {
  try {
    const { course_name, description, start_date, end_date, tuition_fee } = req.body;

      // Handle image path
      // Store path using POSIX-style forward slashes so URL paths are consistent
      const image_path = req.file ? path.posix.join('uploads', 'image', req.file.filename) : null;

    const query = `
        INSERT INTO courses (
          course_name, 
          description, 
          start_date, 
          end_date, 
          tuition_fee,
          image_path,
          created_at, 
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
    `;

    await executeQuery(query, [
      course_name,
      description,
      start_date,
      end_date,
        tuition_fee || null,
        image_path
    ]);

    res.redirect("/courses");
  } catch (err) {
      // Clean up uploaded file if query fails
      if (req.file) {
        fs.unlink(req.file.path, (unlinkErr) => {
          if (unlinkErr) console.error('Error deleting file:', unlinkErr);
        });
      }
    console.error("Course creation error:", err);
    res.status(500).send("Failed to create course");
  }
  }
);


router.post("/courses/:id", 
  checkAuthenticated, 
  authenticateRole("admin"),
  courseImageUpload.single('course_image'),
  async (req, res) => {
  try {
      const courseId = req.params.id;
      let { course_name, description, start_date, end_date, tuition_fee } = req.body;

      // Ensure single values for fields that might be submitted as arrays
      course_name = Array.isArray(course_name) ? course_name[0] : course_name;
      description = Array.isArray(description) ? description[0] : description;
      
      // Get current course info
      const currentCourse = await executeQuery(
        "SELECT image_path FROM courses WHERE id = ?", 
      [courseId]
    );

      if (!currentCourse.length) {
      return res.status(404).send("Course not found");
    }

      let image_path = currentCourse[0].image_path;

      // If new image uploaded, update path and delete old image
      if (req.file) {
        if (image_path) {
          // image_path stored in DB is relative to project root, resolve correctly
          const oldImagePath = path.join(__dirname, '..', image_path);
          try {
            if (fs.existsSync(oldImagePath)) {
              fs.unlink(oldImagePath, err => {
                if (err) console.error("Error deleting old image:", err);
              });
            }
          } catch (e) {
            console.error('Old image deletion check failed:', e);
          }
        }
        // Use POSIX join to store URL-friendly forward slashes
        image_path = path.posix.join('uploads', 'image', req.file.filename);
      }

    const query = `
      UPDATE courses 
      SET course_name = ?,
          description = ?,
          start_date = ?,
          end_date = ?,
          tuition_fee = ?,
            image_path = ?,
          updated_at = GETDATE()
      WHERE id = ?
    `;

    await executeQuery(query, [
      course_name,
      description,
      start_date,
      end_date,
      tuition_fee || null,
        image_path,
      courseId
    ]);

    res.redirect("/courses");
  } catch (err) {
      // Clean up uploaded file if query fails
      if (req.file) {
        fs.unlink(req.file.path, (unlinkErr) => {
          if (unlinkErr) console.error('Error deleting file:', unlinkErr);
        });
      }
    console.error("Course update error:", err);
    res.status(500).send("Failed to update course");
  }
  }
);

router.delete("/courses/:id", 
  checkAuthenticated, 
  authenticateRole("admin"), 
  async (req, res) => {
  try {
    const courseId = req.params.id;

      // Get course info for image deletion
      const course = await executeQuery(
        "SELECT image_path FROM courses WHERE id = ?", 
        [courseId]
      );

      // Delete image file if exists
      if (course[0]?.image_path) {
        const imagePath = path.join(__dirname, '..', course[0].image_path);
        try {
          if (fs.existsSync(imagePath)) {
            fs.unlink(imagePath, err => {
              if (err) console.error("Error deleting course image:", err);
            });
          }
        } catch (e) {
          console.error('Course image deletion check failed:', e);
        }
      }

      // Delete course record
    await executeQuery("DELETE FROM courses WHERE id = ?", [courseId]);
      
    res.redirect("/courses");
  } catch (err) {
    console.error("Course deletion error:", err);
    res.status(500).send("Failed to delete course");
  }
});

router.get(
  "/available-courses",
  checkAuthenticated,
  authenticateRole("student"),
  async (req, res) => {
    try {
      const query = `
        SELECT DISTINCT
          c.id as course_id,
          c.course_name,
          c.description,
          c.start_date,
          c.end_date,
          c.tuition_fee,
          cls.id as class_id,
          cls.class_name,
          cls.start_time,
          cls.end_time,
          cls.weekly_schedule,
          u.full_name as teacher_name,
          (SELECT COUNT(*) FROM enrollments WHERE class_id = cls.id) as enrolled_count
        FROM courses c
        JOIN classes cls ON c.id = cls.course_id
        JOIN teachers t ON cls.teacher_id = t.id
        JOIN users u ON t.user_id = u.id
        WHERE c.start_date > GETDATE()
        AND NOT EXISTS (
          SELECT 1 
          FROM enrollments e
          JOIN students s ON e.student_id = s.id
          WHERE s.user_id = ?
          AND e.class_id = cls.id
        )
        ORDER BY c.start_date ASC
      `;

      const courses = await executeQuery(query, [req.user.id]);

      // Get student information
      const studentQuery = `
        SELECT s.id, u.full_name, u.email 
        FROM students s
        JOIN users u ON s.user_id = u.id
        WHERE s.user_id = ?
      `;
      const studentInfo = await executeQuery(studentQuery, [req.user.id]);

      res.render("courses/availableCourses", {
        courses: courses,
        student: studentInfo[0],
        user: req.user,
      });
    } catch (err) {
      console.error("Error fetching available courses:", err);
      res.status(500).send("Error loading available courses");
    }
  }
);

router.post(
  "/enroll-course",
  checkAuthenticated,
  authenticateRole("student"),
  async (req, res) => {
    try {
      const { class_id } = req.body;

      // Get student ID
      const studentQuery = "SELECT id FROM students WHERE user_id = ?";
      const student = await executeQuery(studentQuery, [req.user.id]);

      if (!student.length) {
        return res.status(404).send("Student not found");
      }

      // Check if class exists and if student is already enrolled
      const checkEnrollmentQuery = `
      SELECT 
        c.id as class_id,
        c.course_id,
        co.tuition_fee,
        (SELECT COUNT(*) FROM enrollments WHERE class_id = c.id) as enrolled_count,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM enrollments e 
            WHERE e.class_id = c.id 
            AND e.student_id = ?
          ) THEN 1 
          ELSE 0 
        END as is_enrolled
      FROM classes c
      JOIN courses co ON c.course_id = co.id
      WHERE c.id = ?
    `;

      const classInfo = await executeQuery(checkEnrollmentQuery, [
        student[0].id,
        class_id,
      ]);

      if (!classInfo.length) {
        return res.status(404).send("Class not found");
      }

      if (classInfo[0].is_enrolled) {
        return res.status(400).send("You are already enrolled in this class");
      }

      // Create enrollment
      const insertQuery = `
      INSERT INTO enrollments (
        student_id, 
        class_id, 
        enrollment_date,
        payment_status,
        updated_at
      )
      VALUES (?, ?, GETDATE(), 0, GETDATE())
    `;

      await executeQuery(insertQuery, [student[0].id, class_id]);

      // Create notification
      const notifyQuery = `
      INSERT INTO notifications (
        user_id,
        message,
        sent_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, GETDATE(), GETDATE(), GETDATE())
    `;

      await executeQuery(notifyQuery, [
        req.user.id,
        "You have successfully enrolled in a new course. Please complete the payment.",
      ]);

      res.redirect("/my-courses");
    } catch (err) {
      console.error("Enrollment error:", err);
      res.status(500).send("Failed to enroll in course");
    }
  }
);

router.get("/my-courses", checkAuthenticated, async (req, res) => {
  try {
    let query;
    let params = [];

    if (req.user.role === "student") {
      query = `
          SELECT 
            c.course_name,
            c.description AS course_description,
            c.tuition_fee,
            c.image_path,
            u.full_name AS teacher_name,
            u.email AS teacher_email,
            u.phone_number AS teacher_phone,   
            cls.class_name,
            CONVERT(VARCHAR(5), cls.start_time, 108) as class_start_time,
            CONVERT(VARCHAR(5), cls.end_time, 108) as class_end_time,
            cls.weekly_schedule,
            e.payment_status,
            e.payment_date,
            CONVERT(VARCHAR(10), e.enrollment_date, 23) as formatted_enrollment_date
          FROM enrollments e
          JOIN students st ON e.student_id = st.id
          JOIN classes cls ON e.class_id = cls.id
          JOIN teachers t ON cls.teacher_id = t.id
          JOIN users u ON t.user_id = u.id
          JOIN courses c ON cls.course_id = c.id
          WHERE st.user_id = ?
          ORDER BY u.full_name, c.course_name
        `;
      params = [req.user.id];
    } else if (req.user.role === "teacher") {
      query = `
          SELECT 
            c.course_name,
            c.description AS course_description,
            c.tuition_fee,
            c.image_path,
            u.full_name AS teacher_name,
            u.email AS teacher_email,
            u.phone_number AS teacher_phone,   
            cls.class_name,
            CONVERT(VARCHAR(5), cls.start_time, 108) as class_start_time,
            CONVERT(VARCHAR(5), cls.end_time, 108) as class_end_time,
            cls.weekly_schedule,
            (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = cls.id) as student_count,
            (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = cls.id AND e.payment_status = 1) as paid_students
          FROM teachers t
          JOIN classes cls ON t.id = cls.teacher_id
          JOIN users u ON t.user_id = u.id
          JOIN courses c ON cls.course_id = c.id
          WHERE t.user_id = ?
          ORDER BY c.course_name
        `;
      params = [req.user.id];
    }

    const courses = await executeQuery(query, params);

    // Process weekly schedule for display
    const processedCourses = courses.map((course) => ({
      ...course,
      schedule: course.weekly_schedule
        ? course.weekly_schedule
            .split(",")
            .map(
              (day) =>
                ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][
                  parseInt(day) - 1
                ]
            )
            .join(", ")
        : "No schedule set",
      formatted_tuition: course.tuition_fee
        ? course.tuition_fee.toLocaleString("vi-VN", {
            style: "currency",
            currency: "VND",
          })
        : "Not set",
    }));

    res.render("courses/my-courses", {
      user: req.user,
      courses: processedCourses,
      messages: {
        error: req.flash("error"),
        success: req.flash("success"),
      },
    });
  } catch (error) {
    console.error("Error fetching courses:", error);
    res.status(500).send("Error loading courses");
  }
});


module.exports = router;