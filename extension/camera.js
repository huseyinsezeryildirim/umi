navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 640 } }).then((s) => (document.getElementById("v").srcObject = s));
