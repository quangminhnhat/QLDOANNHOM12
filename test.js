const sql = require("msnodesqlv8");


const connectionString =
  "Driver={ODBC Driver 17 for SQL Server};Server=LAPTOP-ND7KAD0J;Database=DOANCS;Trusted_Connection=Yes;";

const query = `
SELECT 
    u.id AS user_id,
    u.username,
    CASE 
        WHEN s.id IS NOT NULL THEN 'Student'
        WHEN t.id IS NOT NULL THEN 'Teacher'
        ELSE 'Unknown'
    END AS user_type
FROM users u
LEFT JOIN students s ON u.id = s.user_id
LEFT JOIN teachers t ON u.id = t.user_id;`

//sql query
sql.query(connectionString, query, (err, rows) => {
  if (err) {
    console.error("SQL error:", err);
  } else {
    console.log("Result:", rows);
  }
});
