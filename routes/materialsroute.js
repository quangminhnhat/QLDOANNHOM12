const express = require("express");
const path = require("path");
const sql = require("msnodesqlv8");
const { authenticateRole } = require("../middleware/roleAuth");
const fs = require("fs");
const connectionString = process.env.CONNECTION_STRING; 
const upload = require("../middleware/upload");
const executeQuery = require("../middleware/executeQuery");
const {
  checkAuthenticated,
} = require("../middleware/auth");
const router = express.Router();


router.get(
  "/materials",
  checkAuthenticated,
  async (req, res) => {
    try {
      const query = `
        SELECT m.*, c.course_name 
        FROM materials m
        JOIN courses c ON m.course_id = c.id
        ORDER BY m.uploaded_at DESC
      `;
      const materials = await executeQuery(query);
      res.render("materials/materials", { materials: materials, user: req.user });
    } catch (error) {
      console.error("Fetch materials error:", error);
      res.status(500).send("Database error");
    }
  }
);


router.get(
  "/materials/:id/edit",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      const materialId = req.params.id;

      // Get material details with course info
      const query = `
          SELECT m.*, c.course_name
          FROM materials m
          JOIN courses c ON m.course_id = c.id
          WHERE m.id = ?
        `;

      // Get available courses for dropdown
      const courseQuery = `
          SELECT id, course_name 
          FROM courses 
          WHERE end_date >= GETDATE()
          ORDER BY course_name
        `;

      const [material, courses] = await Promise.all([
        executeQuery(query, [materialId]),
        executeQuery(courseQuery),
      ]);

      if (!material.length) {
        return res.status(404).send("Material not found");
      }

      res.render("materials/editMaterial", {
        material: material[0],
        courses,
        user: req.user,
      });
    } catch (error) {
      console.error("Error loading material edit form:", error);
      res.status(500).send("Error loading material edit form");
    }
  }
);

router.post(
  "/materials/:id",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  upload.single("material"),
  async (req, res) => {
    try {
      const materialId = req.params.id;
      const { course_id } = req.body;
      const file = req.file;

      // Get current material info
      const currentMaterial = await executeQuery(
        "SELECT * FROM materials WHERE id = ?",
        [materialId]
      );

      if (!currentMaterial.length) {
        return res.status(404).send("Material not found");
      }

      let updateQuery = "UPDATE materials SET course_id = ?";
      let queryParams = [course_id];

      // If new file uploaded, update file info
      if (file) {
        // Delete old file
        const oldFilePath = path.join(__dirname, currentMaterial[0].file_path);
        fs.unlink(oldFilePath, (err) => {
          if (err) console.error("Error deleting old file:", err);
        });

        // Update with new file info
        updateQuery += ", file_name = ?, file_path = ?";
        queryParams.push(
          file.originalname,
          path.join("uploads", file.filename)
        );
      }

      updateQuery += ", updated_at = GETDATE() WHERE id = ?";
      queryParams.push(materialId);

      await executeQuery(updateQuery, queryParams);
      res.redirect("/materials");
    } catch (error) {
      console.error("Error updating material:", error);

      // Delete uploaded file if there was an error
      if (req.file) {
        const filePath = path.join(__dirname, "uploads", req.file.filename);
        fs.unlink(filePath, (err) => {
          if (err) console.error("Error deleting file:", err);
        });
      }

      res.status(500).send("Failed to update material");
    }
  }
);
  

router.delete(
  "/materials/:id",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  async (req, res) => {
    const materialId = req.params.id;
    try {
      // 1. Get the file path from the database
      const getFilePathQuery = "SELECT file_path FROM materials WHERE id = ?";
      const result = await executeQuery(getFilePathQuery, [materialId]);

      if (!result || result.length === 0) {
        req.flash("error", "Material not found.");
        return res.redirect("/materials");
      }

      const relativePath = result[0].file_path;
      // Correctly construct the absolute path from the project root
      const absolutePath = path.join(__dirname, "..", relativePath);

      // 2. Delete the record from the database
      const deleteQuery = "DELETE FROM materials WHERE id = ?";
      await executeQuery(deleteQuery, [materialId]);

      // 3. Delete the file from the disk
      fs.unlink(absolutePath, (fsErr) => {
        if (fsErr) {
          // Log the error but don't block the user, as the DB record is gone.
          console.error("File deletion error:", fsErr);
        }
        req.flash("success", "Material deleted successfully.");
        res.redirect("/materials");
      });
    } catch (error) {
      console.error("Error deleting material:", error);
      req.flash("error", "Failed to delete material.");
      res.redirect("/materials");
    }
  }
);

router.get(
  "/upload",
  authenticateRole(["admin", "teacher"]),
  checkAuthenticated,
  async (req, res) => {
    try {
      const courses = await executeQuery("SELECT id, course_name FROM courses ORDER BY course_name");
      res.render("materials/uploadMaterial", { user: req.user, courses: courses });
    } catch (error) {
      console.error("Error loading upload material page:", error);
      res.status(500).send("Error loading page data.");
    }
  }
);

module.exports = router;