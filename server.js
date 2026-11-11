require("dotenv").config();

const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const uploads = path.join(__dirname, "private_uploads");

fs.mkdirSync(uploads, { recursive: true });

const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "soil_portal",
  connectionLimit: 10
});

// Middleware
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "soil.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 28800000
    }
  })
);

// Serve website files from public folder
app.use(express.static(path.join(__dirname, "public")));

// Homepage route - fixes Cannot GET /
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Authentication middleware
const auth = (req, res, next) =>
  req.session.user
    ? next()
    : res.status(401).json({ error: "Please log in first" });

const admin = (req, res, next) =>
  req.session.user?.role === "admin"
    ? next()
    : res.status(403).json({ error: "Admin access required" });

// File upload configuration
const upload = multer({
  storage: multer.diskStorage({
    destination: uploads,
    filename: (req, file, cb) =>
      cb(null, crypto.randomUUID() + ".pdf")
  }),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) =>
    cb(null, file.mimetype === "application/pdf")
});

// Log user actions
async function log(uid, action, details = "") {
  await db.execute(
    "INSERT INTO access_logs(user_id,action,details) VALUES(?,?,?)",
    [uid, action, details]
  );
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Register
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, phone, village, district, password } = req.body;

    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({
        error: "Name, email and password (8+ characters) required"
      });
    }

    const hash = await bcrypt.hash(password, 12);

    const [result] = await db.execute(
      "INSERT INTO users(name,email,phone,village,district,password_hash) VALUES(?,?,?,?,?,?)",
      [
        name,
        email.toLowerCase(),
        phone || "",
        village || "",
        district || "",
        hash
      ]
    );

    req.session.user = {
      id: result.insertId,
      name,
      email: email.toLowerCase(),
      role: "farmer"
    };

    await log(result.insertId, "REGISTER");

    res.json({
      ok: true,
      user: req.session.user
    });
  } catch (error) {
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      error:
        error.code === "ER_DUP_ENTRY"
          ? "Email already registered"
          : "Registration failed"
    });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM users WHERE email=?",
      [String(req.body.email || "").toLowerCase()]
    );

    if (
      !rows.length ||
      !(await bcrypt.compare(
        req.body.password || "",
        rows[0].password_hash
      ))
    ) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    const user = rows[0];

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    await log(user.id, "LOGIN");

    res.json({
      ok: true,
      user: req.session.user
    });
  } catch (error) {
    res.status(500).json({
      error: "Login failed"
    });
  }
});

// Current user
app.get("/api/me", auth, (req, res) => {
  res.json({ user: req.session.user });
});

// Logout
app.post("/api/logout", auth, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Create appointment
app.post("/api/appointments", auth, async (req, res) => {
  try {
    const { crop, sample_notes, preferred_date } = req.body;

    if (!crop) {
      return res.status(400).json({
        error: "Crop is required"
      });
    }

    const [result] = await db.execute(
      "INSERT INTO appointments(user_id,crop,sample_notes,preferred_date) VALUES(?,?,?,?)",
      [
        req.session.user.id,
        crop,
        sample_notes || "",
        preferred_date || null
      ]
    );

    await log(
      req.session.user.id,
      "APPOINTMENT_CREATED",
      String(result.insertId)
    );

    res.json({
      ok: true,
      id: result.insertId
    });
  } catch (error) {
    res.status(500).json({
      error: "Could not save appointment"
    });
  }
});

// Get appointments
app.get("/api/appointments", auth, async (req, res) => {
  try {
    const sql =
      req.session.user.role === "admin"
        ? `SELECT a.*, u.name farmer_name, u.email, u.phone,
           u.village, u.district, r.id report_id
           FROM appointments a
           JOIN users u ON u.id = a.user_id
           LEFT JOIN soil_reports r ON r.appointment_id = a.id
           ORDER BY a.id DESC`
        : `SELECT a.*, r.id report_id
           FROM appointments a
           LEFT JOIN soil_reports r ON r.appointment_id = a.id
           WHERE a.user_id = ?
           ORDER BY a.id DESC`;

    const [rows] =
      req.session.user.role === "admin"
        ? await db.execute(sql)
        : await db.execute(sql, [req.session.user.id]);

    res.json(rows);
  } catch (error) {
    res.status(500).json({
      error: "Could not load appointments"
    });
  }
});

// Update appointment status
app.patch(
  "/api/appointments/:id/status",
  auth,
  admin,
  async (req, res) => {
    const valid = [
      "Pending",
      "Approved",
      "Sample Received",
      "Testing",
      "Completed",
      "Rejected"
    ];

    if (!valid.includes(req.body.status)) {
      return res.status(400).json({
        error: "Invalid status"
      });
    }

    await db.execute(
      "UPDATE appointments SET status=? WHERE id=?",
      [req.body.status, req.params.id]
    );

    res.json({ ok: true });
  }
);

// Upload report
app.post(
  "/api/appointments/:id/report",
  auth,
  admin,
  upload.single("report"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Select a PDF under 5 MB"
        });
      }

      const [appointment] = await db.execute(
        "SELECT id FROM appointments WHERE id=?",
        [req.params.id]
      );

      if (!appointment.length) {
        fs.unlinkSync(req.file.path);

        return res.status(404).json({
          error: "Appointment not found"
        });
      }

      const [oldReport] = await db.execute(
        "SELECT stored_name FROM soil_reports WHERE appointment_id=?",
        [req.params.id]
      );

      if (oldReport.length) {
        try {
          fs.unlinkSync(
            path.join(uploads, oldReport[0].stored_name)
          );
        } catch {}
      }

      await db.execute(
        `INSERT INTO soil_reports
         (appointment_id,original_name,stored_name)
         VALUES(?,?,?)
         ON DUPLICATE KEY UPDATE
         original_name=VALUES(original_name),
         stored_name=VALUES(stored_name),
         uploaded_at=CURRENT_TIMESTAMP`,
        [
          req.params.id,
          req.file.originalname,
          req.file.filename
        ]
      );

      await db.execute(
        "UPDATE appointments SET status='Completed' WHERE id=?",
        [req.params.id]
      );

      await log(
        req.session.user.id,
        "REPORT_UPLOADED",
        req.params.id
      );

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        error: "Upload failed"
      });
    }
  }
);

// Download report
app.get("/api/reports/:id", auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT r.*, a.user_id
     FROM soil_reports r
     JOIN appointments a ON a.id = r.appointment_id
     WHERE a.id=?`,
    [req.params.id]
  );

  if (!rows.length) {
    return res.status(404).json({
      error: "Report not found"
    });
  }

  if (
    req.session.user.role !== "admin" &&
    rows[0].user_id !== req.session.user.id
  ) {
    return res.status(403).json({
      error: "This report does not belong to you"
    });
  }

  await log(
    req.session.user.id,
    "REPORT_ACCESSED",
    req.params.id
  );

  res.download(
    path.join(uploads, rows[0].stored_name),
    rows[0].original_name
  );
});

// Products
app.get("/api/products", async (req, res) => {
  const [rows] = await db.execute(
    `SELECT p.*, u.name seller_name
     FROM products p
     JOIN users u ON u.id = p.seller_id
     ORDER BY p.id DESC`
  );

  res.json(rows);
});

app.post("/api/products", auth, async (req, res) => {
  const {
    title,
    category,
    description,
    price,
    unit,
    location
  } = req.body;

  if (!title || !Number.isFinite(+price) || +price < 0) {
    return res.status(400).json({
      error: "Enter product name and valid price"
    });
  }

  const [result] = await db.execute(
    `INSERT INTO products
     (seller_id,title,category,description,price,unit,location)
     VALUES(?,?,?,?,?,?,?)`,
    [
      req.session.user.id,
      title,
      category || "Produce",
      description || "",
      +price,
      unit || "kg",
      location || ""
    ]
  );

  res.json({
    ok: true,
    id: result.insertId
  });
});

// Shops
app.get("/api/shops", async (req, res) => {
  const [rows] = await db.execute(
    "SELECT * FROM shops WHERE approved=1"
  );

  res.json(rows);
});

// Prices
app.get("/api/prices", async (req, res) => {
  const [crops] = await db.execute(
    "SELECT * FROM crop_prices"
  );

  const [equipment] = await db.execute(
    "SELECT * FROM equipment_prices"
  );

  res.json({
    crops,
    equipment
  });
});

// Admin summary
app.get("/api/admin/summary", auth, admin, async (req, res) => {
  const [[users]] = await db.query(
    "SELECT COUNT(*) n FROM users WHERE role='farmer'"
  );

  const [[appointments]] = await db.query(
    "SELECT COUNT(*) n FROM appointments"
  );

  const [[pending]] = await db.query(
    "SELECT COUNT(*) n FROM appointments WHERE status='Pending'"
  );

  const [[reports]] = await db.query(
    "SELECT COUNT(*) n FROM soil_reports"
  );

  res.json({
    users: users.n,
    appointments: appointments.n,
    pending: pending.n,
    reports: reports.n
  });
});

// Admin users
app.get("/api/admin/users", auth, admin, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT id,name,email,phone,village,district,created_at
     FROM users
     WHERE role='farmer'
     ORDER BY id DESC`
  );

  res.json(rows);
});

// Admin logs
app.get("/api/admin/logs", auth, admin, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT l.*, u.name, u.email
     FROM access_logs l
     LEFT JOIN users u ON u.id = l.user_id
     ORDER BY l.id DESC
     LIMIT 100`
  );

  res.json(rows);
});

// Add shop
app.post("/api/admin/shops", auth, admin, async (req, res) => {
  const {
    name,
    category,
    phone,
    address,
    district
  } = req.body;

  await db.execute(
    `INSERT INTO shops
     (name,category,phone,address,district,approved)
     VALUES(?,?,?,?,?,1)`,
    [
      name,
      category || "",
      phone || "",
      address || "",
      district || ""
    ]
  );

  res.json({ ok: true });
});

// Error handler
app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).json({
    error: "Server error. Check terminal and database settings."
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Portal running on port ${PORT}`);
});