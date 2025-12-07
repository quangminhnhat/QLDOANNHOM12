const express = require("express");
const path = require("path");
const sql = require("msnodesqlv8");
const { authenticateRole } = require("../middleware/roleAuth");
const connectionString = process.env.CONNECTION_STRING; 
const upload = require("../middleware/upload");
const courseImageUpload = require("../middleware/courseImageUpload");
const {
  checkAuthenticated,
} = require("../middleware/auth");
const router = express.Router();






router.post(
  "/upload-material",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  upload.single("material"),
  (req, res) => {
    const { course_id } = req.body;
    const file = req.file;

    if (!course_id || !file) {
      return res.status(400).send("Missing course_id or file.");
    }

    const insertQuery = `
    INSERT INTO materials (course_id, file_name, file_path, uploaded_at)
    VALUES (?, ?, ?, GETDATE())
  `;

    const values = [
      course_id,
      file.originalname,
      path.join("uploads", file.filename),
      file.mimetype,
    ];

    sql.query(connectionString, insertQuery, values, (err) => {
      if (err) {
        console.error("Insert material error:", err);
        return res.status(500).send("Database insert error");
      }
      console.log("Material uploaded successfully.");
      res.send("File uploaded and saved to database.");
    });
  }
);


router.post(
  "/upload-material",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  upload.single("material"),
  (req, res) => {
    const { course_id } = req.body;
    const file = req.file;

    if (!course_id || !file) {
      return res.status(400).send("Missing course_id or file.");
    }

    const insertQuery = `
    INSERT INTO materials (course_id, file_name, file_path, uploaded_at)
    VALUES (?, ?, ?, GETDATE())
  `;

    const values = [
      course_id,
      file.originalname,
      path.join("uploads", file.filename),
      file.mimetype,
    ];

    sql.query(connectionString, insertQuery, values, (err) => {
      if (err) {
        console.error("Insert material error:", err);
        return res.status(500).send("Database insert error");
      }
      console.log("Material uploaded successfully.");
      res.send("File uploaded and saved to database.");
    });
  }
);


module.exports = router;