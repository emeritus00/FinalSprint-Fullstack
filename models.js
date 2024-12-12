// Importing the Mongoose library to interact with a MongoDB database.
const mongoose = require("mongoose");

// Define a schema for users
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  pollsVoted: { type: Number, default: 0 },
});

// Define a schema for poll options
const optionSchema = new mongoose.Schema({
  answer: {
    type: String,
    required: true,
  },
  votes: {
    type: Number,
    default: 0,
  },
});

// Define a schema for polls
const pollSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
  },
  options: {
    type: [optionSchema],
    validate: [arrayLimit, "{PATH} must have at least two options."],
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  votedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // An array of user IDs who have voted in this poll.
});

// Function to validate that the poll has at least two options
function arrayLimit(val) {
  return val.length >= 2;
}

const User = mongoose.model("User", userSchema); // Create a model for users based on the userSchema
const Poll = mongoose.model("Poll", pollSchema); // Create a model for polls based on the pollSchema

// Export the User and Poll models for use in other parts of the application
module.exports = { User, Poll };
