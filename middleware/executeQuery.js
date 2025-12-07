const sql = require("msnodesqlv8");
const connectionString = process.env.CONNECTION_STRING;

function executeQuery(query, params = {}) {
  return new Promise((resolve, reject) => {
    // If params is an array, use parameterized query (msnodesqlv8 supports ? placeholders)
    if (Array.isArray(params)) {
      console.log("---Executing parameterized query:\n", query, "\nparams:", params);
      sql.query(connectionString, query, params, (err, result) => {
        if (err) {
          console.error("Database query error:", err);
          reject(err);
        } else {
          resolve(result);
        }
      });
      return;
    }

    // Otherwise assume params is an object of named values and build DECLARE/SET wrapper
    const declarations = Object.keys(params)
      .map(key => `DECLARE @${key} NVARCHAR(MAX)`)
      .join(';\n');

    const assignments = Object.keys(params)
      .map(key => {
        const val = params[key];
        if (val === null || val === undefined) {
          return `SET @${key} = NULL`;
        }
        const escaped = String(val).replace(/'/g, "''");
        return `SET @${key} = N'${escaped}'`;
      })
      .join(';\n');

    const fullQuery = `\n      ${declarations};\n      ${assignments};\n      ${query}\n    `;

    console.log("---Executing query with named params:\n", fullQuery);

    sql.query(connectionString, fullQuery, [], (err, result) => {
      if (err) {
        console.error("Database query error:", err);
        console.error("Full query:", fullQuery);
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

module.exports = executeQuery;