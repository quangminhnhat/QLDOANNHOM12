require('dotenv').config();
const sql = require("msnodesqlv8");

const connectionString = process.env.CONNECTION_STRING;

if (!connectionString) {
    console.error("Error: CONNECTION_STRING is not defined in your .env file.");
    process.exit(1);
}

const query = `
SELECT 
    u.id AS user_id,
    u.username,
    u.role
FROM users u
`;

async function runTestQuery() {
    console.log("Connecting to the database...");
    
    const connect = () => new Promise((resolve, reject) => {
        sql.open(connectionString, (err, conn) => {
            if (err) {
                return reject(err);
            }
            resolve(conn);
        });
    });

    const executeQuery = (conn, q) => new Promise((resolve, reject) => {
        conn.query(q, (err, results) => {
            if (err) {
                return reject(err);
            }
            resolve(results);
        });
    });

    let conn;
    try {
        conn = await connect();
        console.log("Connection successful.");
        
        console.log("Executing query...");
        const results = await executeQuery(conn, query);
        
        console.log("Query Results:");
        console.table(results);
        
    } catch (err) {
        console.error("An error occurred:", err.message);
    } finally {
        if (conn) {
            conn.close(() => {
                console.log("Connection closed.");
            });
        }
    }
}

runTestQuery();