// Establish a WebSocket connection to the server
const socket = new WebSocket("ws://localhost:3000/ws");

// Listen for messages from the server
socket.addEventListener("message", (event) => {
  const { type, data } = JSON.parse(event.data);

  if (type === "newPoll") {
    onNewPollAdded(data);
  } else if (type === "voteUpdate") {
    onIncomingVote(data);
  }
});

/**
 * Handles adding a new poll to the page when one is received from the server
 *
 * @param {*} data The data from the server (ideally containing the new poll's ID and it's corresponding questions)
 */
function onNewPollAdded(poll) {
  const pollContainer = document.getElementById("polls");

  const pollElement = document.createElement("li");
  pollElement.id = poll._id;
  pollElement.innerHTML = `
    <h2>${poll.question}</h2>
    <ul>
      ${poll.options
        .map(
          (opt) => `
        <li>
          ${opt.answer}: <span id="${poll._id}_${opt.answer}">${opt.votes}</span>
        </li>`
        )
        .join("")}
    </ul>
    <form class="poll-form">
      ${poll.options
        .map(
          (opt) => `
        <button type="button" data-option="${opt.answer}" onclick="vote('${poll._id}', '${opt.answer}')">
          Vote for ${opt.answer}
        </button>`
        )
        .join("")}
    </form>
  `;

  pollContainer.appendChild(pollElement);
}

function vote(pollId, selectedOption) {
  socket.send(JSON.stringify({ pollId, selectedOption }));
}

/**
 * Handles updating the number of votes an option has when a new vote is recieved from the server
 *
 * @param {*} data The data from the server (probably containing which poll was updated and the new vote values for that poll)
 */

function onIncomingVote(poll) {
  poll.options.forEach((opt) => {
    const voteElement = document.getElementById(`${poll._id}_${opt.answer}`);
    if (voteElement) voteElement.textContent = opt.votes;
  });
}
