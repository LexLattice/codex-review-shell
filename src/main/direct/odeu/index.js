"use strict";

module.exports = {
  ...require("./authority"),
  ...require("./artifact"),
  ...require("./digest"),
  ...require("./lifecycle"),
  ...require("./raw-exposure"),
  ...require("./result"),
  ...require("./schema"),
  ...require("./source-ref"),
  ...require("./status"),
};
