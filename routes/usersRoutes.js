const express = require("express");
const sql = require("msnodesqlv8");
const { authenticateRole } = require("../middleware/roleAuth");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const connectionString = process.env.CONNECTION_STRING;
const executeQuery = require("../middleware/executeQuery");
const { checkAuthenticated } = require("../middleware/auth");
const router = express.Router();
const profilePicStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "uploads/profile_pic";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(
      null,
      `user-${req.user.id}-${Date.now()}${path.extname(file.originalname)}`
    );
  },
});
const profilePicUpload = multer({ storage: profilePicStorage });

router.get(
  "/users",
  checkAuthenticated,
  authenticateRole("admin"),
  async (req, res) => {
    try {
      const query = `
      SELECT u.id, u.username, u.role, u.created_at, u.updated_at,
             u.full_name, u.email, u.phone_number AS phone
      FROM users u
      ORDER BY u.created_at DESC;
    `;
      // The original query with multiple LEFT JOINs and COALESCE is complex and
      // has been simplified since the 'users' table now contains all personal info.
      // If you still need the old structure, you can revert the query string.
      const users = await executeQuery(query);
      res.render("userList", { users: users, user: req.user });
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).send("Database error while fetching users.");
    }
  }
);

router.get("/users/:id/edit", checkAuthenticated, async (req, res) => {
  try {
    const userId = req.params.id;
    const query = `
          SELECT u.id, u.username, u.role, u.full_name, u.email, u.phone_number, u.profile_pic, t.salary
          FROM users u
          LEFT JOIN teachers t ON u.id = t.user_id
          WHERE u.id = ?
        `;

    const result = await executeQuery(query, [userId]);

    if (!result.length) {
      return res.status(404).send("User not found");
    }

    res.render("user/editUser", {
      user: req.user,
      editUser: result[0],
      messages: {
        error: req.flash("error"),
        success: req.flash("success"),
      },
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).send("Error loading user data");
  }
});

router.post(
  "/users/:id",
  checkAuthenticated,
  profilePicUpload.single("profile_pic"),
  async (req, res) => {
    const {
      username,
      role,
      full_name,
      email,
      phone_number,
      salary,
      profile_pic,
    } = req.body;
    const userId = req.params.id;
    let connection; // Define connection here to be accessible in catch/finally

    try {
      // 1. Get a dedicated connection for the transaction
      connection = await sql.promises.open(connectionString);

      // Start a transaction
      await connection.promises.beginTransaction();

      // 2. Get the current role of the user being edited
      const roleResult = await connection.promises.query(
        "SELECT role, profile_pic FROM users WHERE id = ?",
        [userId]
      );
      const currentUserData = roleResult.first[0];
      const oldRole = currentUserData?.role;

      if (!oldRole) {
        await connection.promises.rollback();
        return res.status(404).send("User not found.");
      }

      let newProfilePicPath = currentUserData?.profile_pic;
      if (req.file) {
        newProfilePicPath = req.file.path;
        // If there was an old picture, delete it
        const oldPicPath = currentUserData?.profile_pic;
        if (oldPicPath && fs.existsSync(oldPicPath)) {
          fs.unlink(oldPicPath, (err) => {
            if (err) console.error("Error deleting old profile picture:", err);
          });
        }
      }

      // 3. Dynamically build and execute the update query for the 'users' table
      let updateQueryParts = [
        "username = ?",
        "full_name = ?",
        "email = ?",
        "phone_number = ?",
        "profile_pic = ?",
        "updated_at = GETDATE()",
      ];
      let queryParams = [
        username,
        full_name || null,
        email || null,
        phone_number || null,
        newProfilePicPath,
      ];

      // Only add role to the update query if it's provided and different from the old role
      if (role && role !== oldRole) {
        updateQueryParts.push("role = ?");
        queryParams.push(role);
      }

      queryParams.push(userId); // Add the userId for the WHERE clause

      const updateUserQuery = `UPDATE users SET ${updateQueryParts.join(
        ", "
      )} WHERE id = ?`;
      await connection.promises.query(updateUserQuery, queryParams);
      
      // 4. Handle role-specific table changes if the role was modified
      if (role && oldRole !== role) {
        // ** NEW: Check for dependencies before changing role **
        if (oldRole === "student") {
          const studentDepsQuery = `
            SELECT s.id 
            FROM students s
            JOIN enrollments e ON s.id = e.student_id
            WHERE s.user_id = ?
          `;
          const studentDeps = await connection.promises.query(studentDepsQuery, [userId]);
          if (studentDeps.first && studentDeps.first.length > 0) {
            await connection.promises.rollback();
            req.flash("error", "Cannot change role. This student is enrolled in one or more classes. Please unenroll them first.");
            return res.redirect(`/users/${userId}/edit`);
          }
        }
        // ** END NEW **


        // Delete from all old role-specific tables to be safe
        await connection.promises.query(
          "DELETE FROM students WHERE user_id = ?",
          [userId]
        );
        await connection.promises.query(
          "DELETE FROM teachers WHERE user_id = ?",
          [userId]
        );
        await connection.promises.query(
          "DELETE FROM admins WHERE user_id = ?",
          [userId]
        );

        // Insert into the new role-specific table
        if (role === "student") {
          await connection.promises.query(
            "INSERT INTO students (user_id) VALUES (?)",
            [userId]
          );
        } else if (role === "teacher") {
          await connection.promises.query(
            "INSERT INTO teachers (user_id, salary) VALUES (?, ?)",
            [userId, salary || 0]
          );
        } else if (role === "admin") {
          await connection.promises.query(
            "INSERT INTO admins (user_id) VALUES (?)",
            [userId]
          );
        }
      } else {
        // If role is teacher and hasn't changed, just update the salary
        if (role === "teacher" && salary !== undefined) {
          await connection.promises.query(
            "UPDATE teachers SET salary = ? WHERE user_id = ?",
            [salary, userId]
          );
        }
      }

      // 5. If all queries succeeded, commit the transaction
      await connection.promises.commit();

      // Redirect based on who made the change
      if (req.user.role !== "admin") {
        return res.redirect("/profile");
      } else {
        return res.redirect("/users");
      }
    } catch (error) {
      console.error("Error updating user:", error);
      // If an error occurs and a new file was uploaded, delete it
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlink(req.file.path, (err) => {
          if (err)
            console.error(
              "Error deleting uploaded file after failed update:",
              err
            );
        });
      }
      if (connection) {
        console.log("Attempting to rollback transaction...");
        await connection.promises.rollback();
      }
      res.status(500).send("An unexpected error occurred. " + error.message);
    } finally {
      if (connection) {
        await connection.promises.close();
      }
    }
  }
);

router.delete(
  "/users/:id",
  checkAuthenticated,
  authenticateRole("admin"),
  async (req, res) => {
    const userIdToDelete = req.params.id;
    const adminUserId = req.user.id;

    // Prevent an admin from deleting themselves
    if (userIdToDelete == adminUserId) {
      req.flash("error", "You cannot delete your own account.");
      return res.redirect("/users");
    }

    let connection;
    try {
      connection = await sql.promises.open(connectionString);
      await connection.promises.beginTransaction();

      // Get user role to check for dependencies
      const userResult = await connection.promises.query(
        "SELECT role FROM users WHERE id = ?",
        [userIdToDelete]
      );
      if (!userResult.first || userResult.first.length === 0) {
        req.flash("error", "User not found.");
        await connection.promises.rollback();
        return res.redirect("/users");
      }
      const userRole = userResult.first[0].role;

      // Check for dependencies based on role
      if (userRole === "student") {
        const studentDeps = await connection.promises.query(
          `
        SELECT 
          (SELECT COUNT(*) FROM enrollments e JOIN students s ON e.student_id = s.id WHERE s.user_id = ?) as enrollment_count,
          (SELECT COUNT(*) FROM Attempts a JOIN students s ON a.student_id = s.id WHERE s.user_id = ?) as attempt_count
      `,
          [userIdToDelete, userIdToDelete]
        );

        if (
          studentDeps.first[0].enrollment_count > 0 ||
          studentDeps.first[0].attempt_count > 0
        ) {
          req.flash(
            "error",
            "Cannot delete student with existing enrollments or exam attempts."
          );
          await connection.promises.rollback();
          return res.redirect("/users");
        }
      } else if (userRole === "teacher") {
        const teacherDeps = await connection.promises.query(
          "SELECT COUNT(*) as class_count FROM classes c JOIN teachers t ON c.teacher_id = t.id WHERE t.user_id = ?",
          [userIdToDelete]
        );
        if (teacherDeps.first[0].class_count > 0) {
          req.flash(
            "error",
            "Cannot delete teacher assigned to active classes."
          );
          await connection.promises.rollback();
          return res.redirect("/users");
        }
      }

      // If no dependencies, proceed with deletion
      await connection.promises.query("DELETE FROM users WHERE id = ?", [
        userIdToDelete,
      ]);
      await connection.promises.commit();

      req.flash("success", "User deleted successfully.");
      res.redirect("/users");
    } catch (error) {
      console.error("Error deleting user:", error);
      if (connection) await connection.promises.rollback();
      req.flash("error", "Failed to delete user due to a server error.");
      res.redirect("/users");
    } finally {
      if (connection) await connection.promises.close();
    }
  }
);

router.get("/profile", checkAuthenticated, async (req, res) => {
  try {
    const userId = req.user.id;

    // The user's details are all in the 'users' table now.
    const query = `
      SELECT username, role, full_name, email, phone_number, address, profile_pic, CONVERT(varchar(10), date_of_birth, 23) as date_of_birth, created_at, updated_at
      FROM users
      WHERE id = ?
    `;

    const [details] = await executeQuery(query, [userId]);

    if (!details) {
      return res.status(404).send("Profile not found.");
    }

    res.render("user/profile", {
      user: req.user,
      details: details,
    });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).send("Error fetching profile data.");
  }
});

module.exports = router;
