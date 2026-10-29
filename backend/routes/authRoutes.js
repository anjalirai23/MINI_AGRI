const express = require("express");
const router = express.Router();
const { register, login, profile, updateProfile, changePassword, overview } = require("../controllers/authController");
const requireAuth = require("../middleware/auth");

router.post("/register", register);
router.post("/login", login);
router.get("/profile", requireAuth, profile);
router.put("/profile", requireAuth, updateProfile);
router.put("/password", requireAuth, changePassword);
router.get("/overview", requireAuth, overview);

module.exports = router;
