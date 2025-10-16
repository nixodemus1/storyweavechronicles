import React, { useEffect } from "react";

const AdNativeBanner = ({ style }) => {
  useEffect(() => {
    const adDivId = "container-f09c12203dde3fa0d106e0b23285290c";
    let adDiv = document.getElementById(adDivId);
    if (!adDiv) {
      adDiv = document.createElement("div");
      adDiv.id = adDivId;
      document.body.appendChild(adDiv);
    }
    adDiv.innerHTML = "";

    const script = document.createElement("script");
    script.async = true;
    script.setAttribute("data-cfasync", "false");
    script.src = "//pl27859430.effectivegatecpm.com/f09c12203dde3fa0d106e0b23285290c/invoke.js";

    adDiv.appendChild(script);

    return () => {
      adDiv.innerHTML = "";
    };
  }, []);

  return <div id="container-f09c12203dde3fa0d106e0b23285290c" style={style} />;
};

export default AdNativeBanner;
