const executeQuery = require("./executeQuery");

const validateSchedule = async (req, res, next) => {
  try {
    const { class_id, schedule_date } = req.body;

    // Get course dates
    const courseQuery = `
        SELECT co.start_date, co.end_date, co.id as course_id
        FROM courses co
        JOIN classes c ON co.id = c.course_id 
        WHERE c.id = ?
      `;

    const courseDates = await executeQuery(courseQuery, [class_id]);

    if (!courseDates.length) {
      return res.status(404).send("Class or course not found");
    }

    const scheduleDate = new Date(schedule_date);
    const courseStart = new Date(courseDates[0].start_date);
    const courseEnd = new Date(courseDates[0].end_date);

    if (scheduleDate < courseStart || scheduleDate > courseEnd) {
      return res.status(400).send("Schedule date must be within course dates");
    }

    // Add course_id to request body for next middleware
    req.body.course_id = courseDates[0].course_id;
    next();
  } catch (err) {
    console.error("Schedule validation error:", err);
    res.status(500).send("Validation error");
  }
};

module.exports = validateSchedule;