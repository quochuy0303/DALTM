const express = require("express");
require("dotenv").config();
const path = require("path");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

let userProfile;
const app = express();

// Thiết lập EJS làm view engine
app.set("view engine", "ejs");

// Thiết lập session
app.use(session({
    resave: false,
    saveUninitialized: true,
    secret: "SECRET",
}));

// Thiết lập thư mục tĩnh
app.use(express.static(path.join(__dirname, "")));

// Khởi tạo Passport
app.use(passport.initialize());
app.use(passport.session());

// Serialize và deserialize user
passport.serializeUser((user, cb) => cb(null, user));
passport.deserializeUser((obj, cb) => cb(null, obj));

// Cấu hình Google Strategy
passport.use(
    new GoogleStrategy(
        {
            clientID: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            callbackURL: "https://screenshare.herokuapp.com/auth/google/callback"
        },
        function (accessToken, refreshToken, profile, done) {
            userProfile = profile;
            return done(null, userProfile);
        }
    )
);

// Định nghĩa các route
app.get("/", (req, res) => res.render("index"));
app.get("/home", (req, res) => res.render("home", { user: userProfile }));
app.get("/error", (req, res) => res.send("Error logging in"));
app.get("/new-meeting", (req, res) => res.render("new-meeting"));

app.get("/meeting", (req, res) => {
    const meetingID = req.query.meetingID;
    const name = req.query.name;
    res.render("meeting", { meetingID, name });
});

// Route cho xác thực Google
app.get("/auth/google",
    passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/error" }),
    (req, res) => res.redirect("/home")
);

// Khởi động server
const port = process.env.PORT || 4000;
const server = app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});

// Thiết lập Socket.io
const io = require("socket.io")(server, { allowEIO3: true });

let userConnections = [];
io.on("connection", (socket) => {
    console.log("Socket Id:", socket.id);

    socket.on("userconnect", (data) => {
        console.log("User connected:", data.displayName, data.meetingid);
        const otherUsers = userConnections.filter(p => p.meeting_id === data.meetingid);

        userConnections.push({
            connectionId: socket.id,
            user_id: data.displayName,
            meeting_id: data.meetingid,
        });

        otherUsers.forEach(v => {
            socket.to(v.connectionId).emit("inform_others_about_me", {
                other_user_id: data.displayName,
                connId: socket.id,
                userNumber: userConnections.length,
            });
        });

        socket.emit("inform_me_about_other_user", otherUsers);
    });

    socket.on("SDPProcess", (data) => {
        socket.to(data.to_connid).emit("SDPProcess", {
            message: data.message,
            from_connid: socket.id,
        });
    });

    socket.on("sendMessage", (msg) => {
        const mUser = userConnections.find(p => p.connectionId === socket.id);
        if (mUser) {
            const list = userConnections.filter(p => p.meeting_id === mUser.meeting_id);
            list.forEach(v => {
                socket.to(v.connectionId).emit("showChatMessage", {
                    from: mUser.user_id,
                    message: msg,
                });
            });
        }
    });

    socket.on("disconnect", () => {
        console.log("Disconnected:", socket.id);
        const disUser = userConnections.find(p => p.connectionId === socket.id);
        if (disUser) {
            userConnections = userConnections.filter(p => p.connectionId !== socket.id);
            const list = userConnections.filter(p => p.meeting_id === disUser.meeting_id);
            list.forEach(v => {
                socket.to(v.connectionId).emit("inform_other_about_disconnected_user", {
                    connId: socket.id,
                    uNumber: userConnections.length,
                });
            });
        }
    });
});
