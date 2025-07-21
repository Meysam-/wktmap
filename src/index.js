import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import ReactGA from "react-ga4";

ReactGA.initialize("G-WT1E61C5VW");

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <App />
);
