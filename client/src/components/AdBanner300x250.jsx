import React, { useEffect } from "react";

const AdBanner300x250 = () => {
  useEffect(() => {
    const adDivId = "adsterra-banner-300x250";
    let adDiv = document.getElementById(adDivId);
    if (!adDiv) {
      adDiv = document.createElement("div");
      adDiv.id = adDivId;
      document.body.appendChild(adDiv);
    }
    adDiv.innerHTML = "";

    const script1 = document.createElement("script");
    script1.type = "text/javascript";
    script1.innerHTML = `
      atOptions = {
        'key' : '60d6ecc3b38b0ec3c54b334990fa06fb',
        'format' : 'iframe',
        'height' : 250,
        'width' : 300,
        'params' : {}
      };
    `;
    const script2 = document.createElement("script");
    script2.type = "text/javascript";
    script2.src = "//www.highperformanceformat.com/60d6ecc3b38b0ec3c54b334990fa06fb/invoke.js";

    adDiv.appendChild(script1);
    adDiv.appendChild(script2);

    return () => {
      adDiv.innerHTML = "";
    };
  }, []);

  return <div id="adsterra-banner-300x250" style={{ display: "flex", justifyContent: "center" }} />;
};

export default AdBanner300x250;
