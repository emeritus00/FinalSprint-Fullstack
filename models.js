const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  pollsVoted: { type: Number, default: 0 },
});

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
  votedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
});

function arrayLimit(val) {
  return val.length >= 2;
}

const User = mongoose.model("User", userSchema);
const Poll = mongoose.model("Poll", pollSchema);

module.exports = { User, Poll };
