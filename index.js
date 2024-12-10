// Import required modules
const express = require("express");
const expressWs = require("express-ws");
const path = require("path");
const mongoose = require("mongoose");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { User, Poll } = require("./models");

// Define constants
const PORT = 3000;
const MONGO_URI = "mongodb://localhost:27017/keyin_test";

// Initialize Express application
const app = express();
expressWs(app);

// Middleware for parsing request bodies and serving static files
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Set up the view engine and views directory
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Configure session management
app.use(
  session({
    secret: "voting-app-secret",
    resave: false,
    saveUninitialized: false,
  })
);

// Make session data available in all templates
app.use((request, response, next) => {
  response.locals.session = request.session;
  next();
});

// Maintain a list of connected WebSocket clients
let connectedClients = [];

// WebSocket route for real-time voting updates
app.ws("/poll/:id/ws", (socket, request) => {
  const pollId = request.params.id;
  const userId = request.query.userId;

  connectedClients.push({ socket, pollId, userId });

  socket.on("message", async (message) => {
    const { selectedOption, userId } = JSON.parse(message);
    await onNewVote(pollId, selectedOption, userId);
  });

  socket.on("close", () => {
    connectedClients = connectedClients.filter(
      (client) => client.socket !== socket
    );
  });
});

// Process a new vote for a poll
async function onNewVote(pollId, selectedOption, userId) {
  try {
    const poll = await Poll.findById(pollId);
    if (!poll) return;

    // Check if the user has already voted
    if (poll.votedBy.includes(userId)) {
      console.log("User has already voted on this poll.");

      // Send error message only to the user who attempted to vote again
      const client = connectedClients.find(
        (client) => client.pollId === pollId && client.userId === userId
      );
      if (client && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(
          JSON.stringify({
            type: "error",
            message: "You have already voted on this poll.",
          })
        );
      }
      return;
    }

    // Process the vote
    const option = poll.options.find((opt) => opt.answer === selectedOption);
    if (option) {
      option.votes++;
      poll.votedBy.push(userId);
      await poll.save();

      // Notify all connected clients about the updated vote counts
      connectedClients
        .filter((client) => client.pollId === pollId)
        .forEach(({ socket }) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "voteUpdate", data: poll }));
          }
        });
    }
  } catch (error) {
    console.error("Error processing vote:", error);
  }
}

// Routes for rendering pages and handling requests

// Home page route
app.get("/", (request, response) => {
  if (request.session.user?.id) {
    return response.redirect("/dashboard");
  }
  response.render("index/unauthenticatedIndex");
});

// User signup routes
app.get("/signup", (request, response) => {
  response.render("signup", { errorMessage: null });
});

app.post("/signup", async (request, response) => {
  const { username, password } = request.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    response.redirect("/login");
  } catch (error) {
    console.error("Error during signup:", error);
    response.render("signup", { errorMessage: "Username already exists." });
  }
});

// User login routes
app.get("/login", (request, response) => {
  response.render("auth/login", { errorMessage: null });
});

app.post("/login", async (request, response) => {
  const { username, password } = request.body;

  try {
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return response.render("auth/login", {
        errorMessage: "Invalid credentials",
      });
    }

    request.session.user = { id: user._id, username: user.username };
    response.redirect("/dashboard");
  } catch (error) {
    console.error("Error during login:", error);
    response.render("auth/login", {
      errorMessage: "An error occurred. Please try again.",
    });
  }
});

// Logout route
app.get("/logout", (request, response) => {
  request.session.destroy();
  response.redirect("/");
});

// Dashboard route
app.get("/dashboard", async (request, response) => {
  if (!request.session || !request.session.user) {
    return response.redirect("/login");
  }

  try {
    const polls = await Poll.find({ createdBy: request.session.user.id });

    // Retrieve the flash message from the session
    const message = request.session.message;
    request.session.message = null; // Clear the message after retrieving it
    response.render("dashboard", {
      user: request.session.user,
      polls,
      message,
    });
  } catch (err) {
    console.error("Error fetching polls:", err);
    response.status(500).send("Error fetching polls.");
  }
});

// Create a new poll
app.get("/createPoll", (request, response) => {
  if (!request.session.user?.id) return response.redirect("/");
  response.render("createPoll");
});

app.post("/createPoll", async (request, response) => {
  if (!request.session || !request.session.user) {
    return response.redirect("/login");
  }

  console.log("Incoming request body:", request.body);

  try {
    const { question, options } = request.body;

    if (!question.trim()) {
      return response.render("createPoll", {
        errorMessage: "Please provide a question.",
      });
    }

    if (!options || options.length < 2 || options.some((opt) => !opt.trim())) {
      return response.render("createPoll", {
        errorMessage: "Please provide at least two valid options.",
      });
    }

    const formattedOptions = options.map((opt) => ({
      answer: opt.trim(),
    }));

    const poll = new Poll({
      question: question.trim(),
      options: formattedOptions,
      createdBy: request.session.user.id,
    });

    await poll.save();
    request.session.message = "Poll created successfully!";
    response.redirect("/dashboard");
  } catch (error) {
    console.error("Error creating poll:", error);
    response.render("createPoll", {
      errorMessage: "Failed to create poll. Please try again.",
    });
  }
});

app.get("/poll/:id", async (request, response) => {
  if (!request.session || !request.session.user) {
    return response.redirect("/login");
  }

  const pollId = request.params.id;
  if (!mongoose.Types.ObjectId.isValid(pollId)) {
    return response.status(400).send("Invalid Poll ID");
  }

  try {
    const poll = await Poll.findById(request.params.id);
    if (!poll) {
      return response.status(404).send("Poll not found.");
    }

    response.render("poll", { poll, user: request.session.user });
  } catch (error) {
    console.error("Error fetching poll:", error);
    response.status(500).send("Error fetching poll.");
  }
});

app.get("/allPolls", async (request, response) => {
  try {
    const polls = await Poll.find({}).populate("createdBy", "username");
    response.render("allPolls", { polls, user: request.session.user });
  } catch (error) {
    console.error("Error fetching all polls:", error);
    response.status(500).send("Error fetching polls.");
  }
});

app.get("/profile", async (request, response) => {
  if (!request.session || !request.session.user) {
    return response.redirect("/login");
  }

  try {
    const userPolls = await Poll.find({ createdBy: request.session.user.id });
    response.render("profile", {
      user: request.session.user,
      polls: userPolls,
    });
  } catch (error) {
    console.error("Error fetching user polls for profile:", error);
    response.status(500).send("Error fetching profile data.");
  }
});

// MongoDB connection and server start
mongoose
  .connect(MONGO_URI)
  .then(() =>
    app.listen(PORT, () =>
      console.log(`Server running on http://localhost:${PORT}`)
    )
  )
  .catch((error) => console.error("MongoDB connection error:", error));
