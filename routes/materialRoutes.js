const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const upload = require("../middleware/upload");
const executeQuery = require("../middleware/executeQuery");
const { authenticateRole } = require("../middleware/roleAuth");

// You may need to import your authentication middleware
const {
  checkAuthenticated,
} = require("../middleware/auth");

router.post(
  "/upload-material",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  upload.single("material"),
  async (req, res) => {
    try {
      const { course_id } = req.body;
      const file = req.file;

      // Input validation
      if (!course_id || !file) {
        return res.status(400).json({
          error: "Missing required fields",
          details: {
            course_id: !course_id ? "Missing course ID" : null,
            file: !file ? "No file uploaded" : null,
          },
        });
      }

      // Verify course exists first
      const courseCheckQuery = "SELECT id FROM courses WHERE id = ?";
      const courseResult = await executeQuery(courseCheckQuery, [course_id]);

      if (!courseResult || courseResult.length === 0) {
        return res.status(404).json({
          error: "Course not found",
          course_id,
        });
      }

      const insertQuery = `
        INSERT INTO materials (course_id, file_name, file_path, uploaded_at)
        VALUES (?, ?, ?, GETDATE())
      `;

      const values = [
        course_id,
        file.originalname,
        path.join("uploads", file.filename),
      ];

      await executeQuery(insertQuery, values);

      res.redirect("/materials");
    } catch (error) {
      console.error("Material upload error:", error);

      // Delete uploaded file if database insert fails
      if (req.file) {
        const filePath = path.join(__dirname, "..", "uploads", req.file.filename);
        fs.unlink(filePath, (err) => {
          if (err) console.error("Error deleting file:", err);
        });
      }

      res.status(500).json({
        error: "Failed to upload material",
        details: error.message,
      });
    }
  }
);

module.exports = router;