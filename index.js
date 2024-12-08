const express = require("express");
const expressWs = require("express-ws");
const path = require("path");
const mongoose = require("mongoose");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { User, Poll } = require("./models");

const PORT = 3000;
const MONGO_URI = "mongodb://localhost:27017/keyin_test";
const app = express();
expressWs(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(
  session({
    secret: "voting-app-secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.use((request, response, next) => {
  response.locals.session = request.session;
  next();
});

let connectedClients = [];

app.ws("/poll/:id/ws", (socket, request) => {
  const pollId = request.params.id;

  connectedClients.push({ socket, pollId });

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

async function onNewVote(pollId, selectedOption, userId) {
  try {
    const poll = await Poll.findById(pollId);
    if (!poll) return;

    if (poll.votedBy.includes(userId)) {
      console.log("User has already voted on this poll.");
      connectedClients
        .filter((client) => client.pollId === pollId)
        .forEach(({ socket }) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: "error",
                message: "You have already voted on this poll.",
              })
            );
          }
        });
      return;
    }

    const option = poll.options.find((opt) => opt.answer === selectedOption);
    if (option) {
      option.votes++;
      poll.votedBy.push(userId);
      await poll.save();

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

app.get("/", (request, response) => {
  if (request.session.user?.id) {
    return response.redirect("/dashboard");
  }
  response.render("index/unauthenticatedIndex");
});

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

app.get("/login", (request, response) => {
  response.render("auth/login", { errorMessage: null });
});

app.post("/login", async (request, response) => {
  const { username, password } = request.body;

  try {
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return response.render("login", { errorMessage: "Invalid credentials" });
    }

    request.session.user = { id: user._id, username: user.username };
    response.redirect("/dashboard");
  } catch (error) {
    console.error("Error during login:", error);
    response.render("login", {
      errorMessage: "An error occurred. Please try again.",
    });
  }
});

app.get("/logout", (request, response) => {
  request.session.destroy();
  response.redirect("/");
});

app.get("/dashboard", async (request, response) => {
  if (!request.session || !request.session.user) {
    return response.redirect("/login");
  }

  try {
    const polls = await Poll.find({ createdBy: request.session.user.id });
    response.render("dashboard", { user: request.session.user, polls });
  } catch (err) {
    console.error("Error fetching polls:", err);
    response.status(500).send("Error fetching polls.");
  }
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
    response.redirect("/dashboard");
  } catch (error) {
    console.error("Error creating poll:", error);
    response.render("createPoll", {
      errorMessage: "Failed to create poll. Please try again.",
    });
  }
});

app.get("/createPoll", (request, response) => {
  if (!request.session.user?.id) return response.redirect("/");
  response.render("createPoll");
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

mongoose
  .connect(MONGO_URI)
  .then(() =>
    app.listen(PORT, () =>
      console.log(`Server running on http://localhost:${PORT}`)
    )
  )
  .catch((error) => console.error("MongoDB connection error:", error));
