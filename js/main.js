// Set up Cesium viewer
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIyZWUyZmNiMS05ZDc4LTRmNjctYTJiNi01Y2M2MzhhNTdjMzAiLCJpZCI6Mjc1ODI3LCJpYXQiOjE3Mzk0NzExNjZ9.Qn9b6Vw2pHbDTdKLPmJoSLcG9W1QGocgKO7KGMfRwa8';

const viewer = new Cesium.Viewer('cesiumContainer', {
    animation: false,  // Remove Cesium's timeline
    timeline: false,   // Disable time controls
    baseLayerPicker: false,  // Disable map switching
});

// Optionally hide Cesium Ion credits
viewer.cesiumWidget.creditContainer.style.display = "none";
