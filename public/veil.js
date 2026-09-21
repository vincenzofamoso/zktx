const connect = document.querySelector("#connect");
const submit = document.querySelector(".submit");
const form = document.querySelector("#veil-form");
const result = document.querySelector("#form-result");
const actionTitle = document.querySelector("#action-title");
const actionCopy = document.querySelector("#action-copy");

const copy = {
  shield: ["Create a shielded note", "Your deposit is public. Activity after shielding uses private notes."],
  send: ["Send a private note", "Recipient ownership and value are encrypted inside the shielded note set."],
  swap: ["Swap inside the pool", "The proof conserves both assets without publishing the user's order."],
  withdraw: ["Return to a public wallet", "The withdrawal destination and amount become public at the boundary."],
};

let connected = false;
document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => {
  document.querySelector(".tabs .selected")?.classList.remove("selected");
  button.classList.add("selected");
  [actionTitle.textContent, actionCopy.textContent] = copy[button.dataset.tab];
}));

connect.addEventListener("click", async () => {
  if (!window.ethereum) {
    result.textContent = "Install an EVM wallet to preview Robinhood Chain connectivity.";
    return;
  }
  try {
    const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
    connected = Boolean(account);
    connect.textContent = connected ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet";
    submit.textContent = "Protocol contracts pending";
    submit.disabled = true;
    result.textContent = "Wallet connected. Mainnet actions stay disabled until audited verifier and vault contracts are deployed.";
  } catch (error) {
    result.textContent = error?.message || "Wallet connection was cancelled.";
  }
});

form.addEventListener("submit", (event) => event.preventDefault());
