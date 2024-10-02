chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        if (request.action === "showdevtools") {
            chrome.devtools.panels.create('Caplin', null, 'caplin-devtools-gui/index.html', null);
        }
    }
);

chrome.tabs.sendMessage(chrome.devtools.inspectedWindow.tabId, {query: "showdevtools"});
