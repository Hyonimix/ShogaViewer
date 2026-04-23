chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-with-shoga",
    title: "Open folder with Shoga Viewer",
    contexts: ["all"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-with-shoga") {
    chrome.tabs.create({ url: "index.html" });
  }
});

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: "index.html" });
});
