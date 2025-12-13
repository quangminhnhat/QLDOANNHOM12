if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
require("events").EventEmitter.defaultMaxListeners = 20;

//lib import
const express = require("express");
const app = express();
const path = require("path");
const bcrypt = require("bcrypt");
const sql = require("msnodesqlv8");
const passport = require("passport");
const flash = require("express-flash");
const session = require("express-session");
const methodOverride = require("method-override");
const { authenticateRole } = require("./middleware/roleAuth");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const https = require("https");
const connectionString = process.env.CONNECTION_STRING;
const upload = require("./middleware/upload");
const courseImageUpload = require("./middleware/courseImageUpload");
const executeQuery = require("./middleware/executeQuery");
const {
  checkAuthenticated,
  checkNotAuthenticated,
} = require("./middleware/auth");
const validateSchedule = require("./middleware/validateSchedule");

// Static files
app.use(express.static(path.join(__dirname, "public")));

//routes

const userRoutes = require("./routes/usersRoutes");
const miscroutes = require("./routes/MiscRoute");
const furnitureRoutes = require("./routes/furnitureRoute");
const roomRoutes = require("./routes/RoomRoute");


// Essential middleware
app.use(express.json());
// Use extended: true so nested form fields like scores[123] are parsed into objects
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));

// Session setup
app.use(flash());
app.use(
  session({
    secret: process.env.SECRET_KEY,
    resave: false,
    saveUninitialized: false,
  })
);

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

const initalizePassport = require("./middleware/pass-config");
initalizePassport(
  passport,
  (email) => {
    console.log("Looking up user by email:", email);
    // Lookup directly on users.email (students/teachers/admins don't have an email column)
    const query = `
      SELECT u.*
      FROM users u
      WHERE u.email = ?
    `;
    return new Promise((resolve, reject) => {
      sql.query(connectionString, query, [email], (err, rows) => {
        if (err) {
          console.error("SQL error:", err);
          return reject(new Error(err));
        }
        if (rows.length > 0) {
          resolve(rows[0]);
        } else {
          resolve(null);
        }
      });
    });
  },
  (id) => {
    const query = `SELECT * FROM users WHERE id = ?`;
    return new Promise((resolve, reject) => {
      sql.query(connectionString, query, [id], (err, rows) => {
        if (err) {
          console.error("SQL error:", err);
          return reject(new Error(err));
        }
        if (rows.length > 0) {
          resolve(rows[0]);
        } else {
          resolve(null);
        }
      });
    });
  }
);

// Serve uploaded files statically

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

//routing
app.use(userRoutes);
app.use(miscroutes);
app.use("/furniture", furnitureRoutes);
app.use("/rooms", roomRoutes);

app.post(
  "/login",
  checkNotAuthenticated,
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login",
    failureFlash: true,
  })
);
/*app.post("/login", async (req, res) => {
  try {
    sql.query(
      connectionString,
      "SELECT * FROM users WHERE username = ?",
      [req.body.Name],
      (err, result) => {
        if (err) {
          console.error("Query error:", err);
          return res.status(500).send("Database query error");
        }
        if (result.length === 0) {
          return res.status(401).send("Invalid username or password");
        }

        const user = result[0];
        bcrypt.compare(req.body.password, user.password, (err, isMatch) => {
          if (err) {
            console.error("Password comparison error:", err);
            return res.status(500).send("Password comparison error");
          }
          if (!isMatch) {
            res.redirect("/login"); // Redirect to login page if password is incorrect
          }
          // Successful login
          res.redirect("/"); // Redirect to home page after successful login
        });
      }
    );
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).send("An unexpected error occurred");
  }


});*/



app.get("/login", checkNotAuthenticated, (req, res) => {
  res.render("login.ejs");
});


/*
link bình thường
app.get("link ở đây", (req, res) => {
  res.render("view ở đây ");
});
*/

/*
link role
app.get("/admin", checkAuthenticated, authenticateRole("admin"), (req, res) => {
  res.render("admin.ejs", { user: req.user });
}); 
*/
app.delete("/logout", (req, res) => {
  req.logOut((err) => {
    if (err) {
      console.error("Error during logout:", err);
      return res.status(500).send("Logout error");
    }
    res.redirect("/");
  });
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

//route end

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const DOMAIN_NAME = process.env.DOMAIN_NAME || null;
const dns = require("dns").promises;
const multicastDns = require("multicast-dns");

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
      if (net.family === "IPv4" && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
}

app.listen(PORT, HOST, async () => {
  console.log(`\nServer is online on port ${PORT}`);
  console.log(`- Local: http://localhost:${PORT}`);

  const ips = getLocalIPs();
  if (ips.length > 0) {
    for (const ip of ips) {
      console.log(`- On Your Network: http://${ip}:${PORT}`);
    }
  } else {
    console.warn("⚠ Warning: No non-internal network interfaces detected.");
  }

  // Broadcast service on the local network using mDNS (.local domain)
  const serviceName = DOMAIN_NAME
    ? DOMAIN_NAME.replace(/\.local$/, "")
    : "my-app";
  const localDomain = `${serviceName}.local`;

  const mdns = multicastDns();

  mdns.on("query", (query) => {
    // Find all A (IPv4) and AAAA (IPv6) queries for our local domain
    const questions = query.questions.filter(
      (q) =>
        (q.type === "A" || q.type === "AAAA") && q.name.toLowerCase() === localDomain.toLowerCase()
    );

    if (questions.length === 0) return;

    // Respond with all local IP addresses
    const localIPs = getLocalIPs();
    const answers = localIPs.map((ip) => ({
      name: localDomain,
      type: "A",
      ttl: 300, // 5 minutes
      data: ip,
    }));

    mdns.respond({
      answers: answers,
    });
  });
  console.log(`- On Your Network (mDNS): http://${localDomain}:${PORT}`);
  console.log(`  (Resolves on devices with mDNS/Bonjour support)`);
});

// Configure connection pool
const pool = {
  max: 10, // Maximum number of connections
  min: 0, // Minimum number of connections
  idleTimeoutMillis: 30000, // How long a connection can be idle before being released
};

// Test database connection on startup
async function testConnection() {
  try {
    await executeQuery("SELECT 1");
    console.log("Database connection successful");
  } catch (error) {
    console.error("Database connection failed:", error);
    process.exit(1); // Exit if we can't connect to database
  }
}

testConnection();

// Add error handler middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);

  if (err.code === "ECONNREFUSED") {
    return res.status(503).json({
      error: "Database connection failed",
      details: "Unable to connect to database server",
    });
  }

  if (err.code === "PROTOCOL_CONNECTION_LOST") {
    return res.status(503).json({
      error: "Database connection lost",
      details: "Connection to database was lost",
    });
  }

  res.status(500).json({
    error: "Internal server error",
    details: err.message,
  });
});
