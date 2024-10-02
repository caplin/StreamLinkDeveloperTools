console.log("dev tools loaded");

function connectToContentScript() {

    var port = chrome.tabs.connect(chrome.devtools.inspectedWindow.tabId);
    console.log("connected to tab: ", chrome.devtools.inspectedWindow.tabId);
    port.onMessage.addListener(function (message) {
        // console.log(message);
        let textNode = document.createTextNode(JSON.stringify(message, null, " ") + " " + Date.now());
        document.body.appendChild(textNode);
        document.body.appendChild(document.createElement("div"));
    });
    // console.log("added listener");
}

connectToContentScript();

// Listen for the page refresh event
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    // Check if the page has completed reloading
    if (tabId === chrome.devtools.inspectedWindow.tabId && changeInfo.status === "complete") {
        // Reconnect the channel to the content script
        connectToContentScript();
    }
});





