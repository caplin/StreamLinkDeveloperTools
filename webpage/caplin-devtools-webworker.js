// @ts-nocheck
const LOG_SIZE = 10_000;
const CHART_SIZE = 60;

class Content {
    constructor(isChromeExtension) {
        this.connectedToStreamLinkApp = false;
        this.logLines = new RingBuffer(LOG_SIZE);
        this.apiLines = new RingBuffer(LOG_SIZE);
        this.chartData = new RingBuffer(CHART_SIZE);
        this.currentChartBucket = {time: Date.now(), in: 0, out: 0};
        this.nextChartTime = Date.now() + 1000;
        this.objects = new Map();
        this.showDevTools = false;
        this.toolsConfig = {};
        this.toolsConfigApplied = false;

        // can be used as a Chrome extension content script talking to a Chrome dev tools panel
        // or loaded as a webworker and talking to the gui in a separate browser tab using broadcast channels
        if (isChromeExtension) {
            this.chromeExtensionWaitForStreamlinkMessage();
        } else {
            this.webPageWaitForStreamlinkMessage();
        }
    }

    webPageWaitForStreamlinkMessage() {
        var windowMessageListener = (event) => {
            if (event.data.source === "__caplin_streamlink__") {
                if (!this.connectedToStreamLinkApp) {
                    this.startChartUpdating();
                    this.webStartup();
                    this.connectedToStreamLinkApp = true;
                }
                this.handleMessage(event.data);
                //  console.log(event.data);
            }
        };

        onmessage = windowMessageListener;
    }

    webStartup() {
        const portFromStreamLink = new BroadcastChannel("__from_caplin_streamlink__")
        const portToStreamLink = new BroadcastChannel("__to_caplin_streamlink__")

        let selectedSubscriptionId = null;
        let lastLogLineSent = this.logLines.getFirst();
        let lastApiLineSent = this.apiLines.getFirst();
        let lastChartDataSent = this.chartData.getFirst();
        let lastUpdateCount = -1;
        let connected = false;
        let timer;

        const sendUpdate = (type) => {
            try {
                let message = {
                    type: type,
                    subscriptions: this.getSubscriptions(),
                    // selectedSubscriptionId,
                    logLines: this.logLines.getRange(Math.max(this.logLines.getFirst(), lastLogLineSent), this.logLines.getLast()),
                    apiLines: this.apiLines.getRange(Math.max(this.apiLines.getFirst(), lastApiLineSent), this.apiLines.getLast()),
                    chartData: this.chartData.getRange(Math.max(this.chartData.getFirst(), lastChartDataSent), this.chartData.getLast()),
                };
                if (type === "initial") {
                    message.toolsConfig = this.toolsConfig;
                    message.toolsConfigApplied = this.toolsConfigApplied;
                }

                portFromStreamLink.postMessage(message);

                // only send subscription if it has changed
                const subscription = this.objects.get(selectedSubscriptionId);
                if (subscription != undefined && this.getCombinedUpdateCount(subscription) !== lastUpdateCount) {
                    message = {
                        type: "updateSubscription",
                        subscription: this.getExpandedSubscription(selectedSubscriptionId)
                    };
                    portFromStreamLink.postMessage(message);
                    lastUpdateCount = this.getCombinedUpdateCount(subscription);
                }

                // console.log("sendUpdate", message);
                lastLogLineSent = this.logLines.getLast();
                lastApiLineSent = this.apiLines.getLast();
                lastChartDataSent = this.chartData.getLast();
            } catch (e) {
                console.log("error sending update to port", port, e);
            }
        }

        portToStreamLink.onmessage = (event) => {
            const inMessage = event.data;
            // console.log("message from gui", inMessage);
            if (!connected || inMessage.type === "connect") {
                selectedSubscriptionId = null;
                lastLogLineSent = this.logLines.getFirst();
                lastApiLineSent = this.apiLines.getFirst();
                lastChartDataSent = this.chartData.getFirst();
                lastUpdateCount = -1;
                sendUpdate("initial");

                if (!timer) {
                    timer = setInterval(() => {
                        sendUpdate("update");
                    }, 1000);
                }
                connected = true;
            }

            switch (inMessage.type) {
                case "connect":
                    break;
                case "setSubscriptionId":
                    selectedSubscriptionId = inMessage.subscriptionId;
                    let subscription = this.objects.get(selectedSubscriptionId);
                    if (subscription != undefined) {
                        const message = {
                            type: "updateSubscription",
                            subscription: this.getExpandedSubscription(selectedSubscriptionId)
                        };
                        portFromStreamLink.postMessage(message);
                        lastUpdateCount = this.getCombinedUpdateCount(subscription);
                    }
                    break;
                case "setToolsConfig":
                    this.toolsConfig = inMessage.toolsConfig;
                    postMessage(inMessage);
                    this.toolsConfigApplied = true;
                    break;
            }
        };

        portFromStreamLink.postMessage({type: "connect"});
    }

    chromeExtensionWaitForStreamlinkMessage() {
        var windowMessageListener = (event) => {
            if (event.data.source === "__caplin_streamlink__") {
                if (!this.connectedToStreamLinkApp) {
                    this.startChartUpdating();
                    this.chromeStartup();
                    this.connectedToStreamLinkApp = true;
                }
                if (!this.showDevTools) {
                    chrome.runtime.sendMessage({action: "showdevtools"});
                    this.showDevTools = true;
                }
                this.handleMessage(event.data);
            }
        };

        window.addEventListener("message", windowMessageListener, false);
    }

    chromeStartup() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (this.showDevTools) {
                chrome.runtime.sendMessage({action: "showdevtools"});
            }
        });

        chrome.runtime.onConnect.addListener((port) => {
            if (port.name === "__caplin_streamlink_devtool__") {
                let selectedSubscriptionId = null;
                let lastLogLineSent = this.logLines.getFirst();
                let lastApiLineSent = this.apiLines.getFirst();
                let lastChartDataSent = this.chartData.getFirst();
                let lastUpdateCount = -1;

                const sendUpdate = (type) => {
                    try {
                        let message = {
                            type: type,
                            subscriptions: this.getSubscriptions(),
                            // selectedSubscriptionId,
                            logLines: this.logLines.getRange(Math.max(this.logLines.getFirst(), lastLogLineSent), this.logLines.getLast()),
                            apiLines: this.apiLines.getRange(Math.max(this.apiLines.getFirst(), lastApiLineSent), this.apiLines.getLast()),
                            chartData: this.chartData.getRange(Math.max(this.chartData.getFirst(), lastChartDataSent), this.chartData.getLast()),
                        };
                        if (type === "initial") {
                            message.toolsConfig = this.toolsConfig;
                            message.toolsConfigApplied = this.toolsConfigApplied;
                        }

                        port.postMessage(message);

                        // only send subscription if it has changed
                        const subscription = this.objects.get(selectedSubscriptionId);
                        if (subscription != undefined && this.getCombinedUpdateCount(subscription) !== lastUpdateCount) {
                            message = {
                                type: "updateSubscription",
                                subscription: this.getExpandedSubscription(selectedSubscriptionId)
                            };
                            port.postMessage(message);
                            lastUpdateCount = this.getCombinedUpdateCount(subscription);
                        }

                        // console.log("sendUpdate", message);
                        lastLogLineSent = this.logLines.getLast();
                        lastApiLineSent = this.apiLines.getLast();
                        lastChartDataSent = this.chartData.getLast();
                    } catch (e) {
                        console.log("error sending update to port", port, e);
                    }
                }

                sendUpdate("initial");

                const timer = setInterval(() => {
                    sendUpdate("update");
                }, 1000);

                port.onMessage.addListener(async (inMessage) => {
                    // console.log("message from devtools", inMessage);
                    switch (inMessage.type) {
                        case "setSubscriptionId":
                            selectedSubscriptionId = inMessage.subscriptionId;
                            let subscription = this.objects.get(selectedSubscriptionId);
                            if (subscription != undefined) {
                                const message = {
                                    type: "updateSubscription",
                                    subscription: this.getExpandedSubscription(selectedSubscriptionId)
                                };
                                port.postMessage(message);
                                lastUpdateCount = this.getCombinedUpdateCount(subscription);
                            }
                            break;
                        case "setToolsConfig":
                            this.toolsConfig = inMessage.toolsConfig;
                            window.postMessage(inMessage, "*");
                            // await chrome.storage.local.set({"ToolsV1": inMessage.toolsConfig})
                            this.toolsConfigApplied = true;
                            break;
                    }
                });

                port.onDisconnect.addListener((port) => {
                    // console.log("ondisconnect", port);
                    clearInterval(timer);
                });
            }
        });
    }

    startChartUpdating() {
        // force update of chart data each second even when no data flowing (however this will not work if page is backgrounded due to chrome throttling of timers)
        const self = this;
        setInterval(() => {
            const now = Date.now();
            while (this.nextChartTime < now) {
                this.chartData.add(this.currentChartBucket);
                this.currentChartBucket = {time: this.nextChartTime, in: 0, out: 0};
                this.nextChartTime += 1000;
            }
        }, 1000);
    }

    handleMessage(message) {
        if (message.type === "toolsConfig") {
            this.toolsConfig = message.toolsConfig;
        } else if (message.type === "log") {
            const line = {lineNumber: message.lineNumber, line: message.line, level: message.level};
            this.logLines.add(line);
            if (message.level === 8) { // FINEST
                let inPos = message.line.indexOf(": <");
                let outPos = message.line.indexOf(": >");

                if (inPos !== -1 || outPos !== -1) { // something to record
                    // add current bucket to chartData and fill in any missing seconds
                    const now = Date.now();
                    while (this.nextChartTime < now) {
                        this.chartData.add(this.currentChartBucket);
                        this.currentChartBucket = {time: this.nextChartTime, in: 0, out: 0};
                        this.nextChartTime += 1000;
                    }
                }

                if (inPos != -1) {
                    this.currentChartBucket.in += message.line.length - inPos - 4;
                }

                if (outPos != -1) {
                    this.currentChartBucket.out += message.line.length - outPos - 4;
                }
            }

        } else if (message.type === "call" || message.type === "callback") {
            this.apiLines.add(message);

            const params = message.params;
            const subject = params ? params.subject : undefined;
            const subscriptionId = message.subscriptionId;

            switch (message.classType + "." + message.method) {
                case "StreamLink.disconnect": {
                    // remove subscriptions for this streamlink
                    for (let [id, subscription] of this.objects) {
                        if (subscription.streamlinkId === message.streamlinkId) {
                            // console.log("removing subscriptions for " + subscription.subject);
                            this.objects.delete(id);
                        }
                    }
                }
                    break;
                case "StreamLink.subscribe":
                    this.objects.set(subscriptionId, {
                        subject,
                        subscriptionId,
                        params: params,
                        type: "unknown",
                        subscriptionTime: message.timestamp,
                        caller: message.caller,
                        lineNumber: message.lineNumber,
                        streamlinkId: message.streamlinkId,
                        updateCount: 0,
                        updateTime: "",
                        data: {}
                    });
                    break;

                case "Subscription.unsubscribe":
                    const obj = this.objects.get(subscriptionId);
                    if (obj && obj.type === "container") {
                        if (obj.data.container && obj.data.container.elements) {
                            for (let j = 0; j < obj.data.container.elements.length; j++) {
                                this.objects.delete(subscriptionId + obj.data.container.elements[j]);
                            }
                        }
                    }
                    this.objects.delete(subscriptionId);
                    break;

                case "Subscription.setContainerWindow":
                    break;

                case "SubscriptionListener.onRecordUpdate":
                    if (this.objects.has(subscriptionId)) {
                        let obj = this.getObjectToUpdate(subscriptionId, params.subject);
                        if (obj) {
                            if (!obj.data.recordType1) {
                                obj.data.recordType1 = {fields: {}};
                            }
                            if (params.image) {
                                obj.data.recordType1.fields = params.fields;
                            } else {
                                obj.data.recordType1.fields = {...obj.data.recordType1.fields, ...params.fields};
                            }

                            obj.type = "record";
                            this.updateCommon(obj, message);
                        }
                    }
                    break;

                case "SubscriptionListener.onRecordType2Update":
                    if (this.objects.has(subscriptionId)) {
                        let obj = this.getObjectToUpdate(subscriptionId, params.subject);
                        if (obj) {
                            if (!obj.data.recordType2) {
                                obj.data.recordType2 = {elements: {}};
                            }

                            const indexField = params.indexField;
                            if (params.deleteRow === true) {
                                delete obj.data.recordType2.elements[indexField];
                            } else if (params.deleteAllRows === true) {
                                obj.data.recordType2.elements = {};
                            } else if (params.image) {
                                let element = obj.data.recordType2.elements[indexField];
                                if (element === undefined) {
                                    obj.data.recordType2.elements[indexField] = {fields: params.fields};
                                } else {
                                    element.fields = params.fields;
                                }
                            } else {
                                let element = obj.data.recordType2.elements[indexField];
                                if (element === undefined) {
                                    obj.data.recordType2.elements[indexField] = {fields: params.fields};
                                } else {
                                    element.fields = {...element.fields, ...params.fields};
                                }
                            }
                            obj.type = "record";
                            this.updateCommon(obj, message);
                        }
                    }
                    break;

                case "SubscriptionListener.onRecordType3Update":
                    if (this.objects.has(subscriptionId)) {
                        let obj = this.getObjectToUpdate(subscriptionId, params.subject);
                        if (obj) {
                            if (!obj.data.recordType3) {
                                obj.data.recordType3 = {elements: []};
                            }

                            // streamlink/liberator bug? ref use of image/clear
                            // if (params.deleteAllEntries === true) {
                            //     obj.data.recordType3.elements = [];
                            // } else {
                            obj.data.recordType3.elements.push({fields: params.fields});
                            // }
                            obj.type = "record";
                            this.updateCommon(obj, message);
                        }
                    }
                    break;

                case "SubscriptionListener.onPermissionUpdate":
                    if (this.objects.has(subscriptionId)) {
                        let obj = this.getObjectToUpdate(subscriptionId, params.subject);
                        if (obj) {
                            if (!obj.data.permission) {
                                obj.data.permission = {elements: {}};
                            }

                            const indexField = params.indexField;
                            if (params.deleteRow === true) {
                                delete obj.data.permission.elements[indexField];
                            } else if (params.deleteAllRows === true) {
                                obj.data.permission.elements = {};
                            } else if (params.image) {
                                let element = obj.data.permission.elements[indexField];
                                if (element === undefined) {
                                    obj.data.permission.elements[indexField] = {fields: params.fields};
                                } else {
                                    element.fields = params.fields;
                                }
                            } else {
                                let element = obj.data.permission.elements[indexField];
                                if (element === undefined) {
                                    obj.data.permission.elements[indexField] = {fields: params.fields};
                                } else {
                                    element.fields = {...element.fields, ...params.fields};
                                }
                            }
                            obj.type = "permission";
                            this.updateCommon(obj, message);
                        }
                    }
                    break;

                case "SubscriptionListener.onContainerUpdate":
                    if (this.objects.has(subscriptionId)) {
                        const obj = this.objects.get(subscriptionId);
                        obj.windowStart = params.windowStart;
                        obj.windowEnd = params.windowEnd;
                        obj.size = params.size;
                        obj.type = "container";

                        if (!obj.data.container) {
                            obj.data.container = {elements: []};
                            obj.elementUpdateCount = 0;
                            obj.elementUpdateTime = "";
                        }

                        for (let i = 0; i < params.ops.length; i++) {
                            const op = params.ops[i];

                            switch (op.op) {
                                case "clear":
                                    for (let j = 0; j < obj.data.length; j++) {
                                        this.objects.delete(subscriptionId + obj.data.container.elements[j]);
                                    }
                                    obj.data.container = {elements: []};
                                    break;
                                case "insert":
                                    obj.data.container.elements.splice(op.index, 0, op.subject);
                                    this.objects.set(subscriptionId + op.subject, {
                                        subject: op.subject,
                                        type: "unknown",
                                        parentId: subscriptionId,
                                        updateCount: 0,
                                        data: {}
                                    });
                                    break;
                                case "remove":
                                    this.objects.delete(subscriptionId + obj.data[op.index]);
                                    obj.data.container.elements.splice(op.index, 1);
                                    break;
                                case "move":
                                    const oldSubject = obj.data.container.elements[op.from];
                                    obj.data.container.elements.splice(op.from, 1);
                                    obj.data.container.elements.splice(op.to, 0, oldSubject);
                                    break;
                            }
                        }

                        this.updateCommon(obj, message);
                    }
                    break;

                case "SubscriptionListener.onJsonUpdate":
                    if (this.objects.has(subscriptionId)) {
                        let obj = this.getObjectToUpdate(subscriptionId, params.subject);
                        if (obj) {
                            obj.data.json = params.json;
                            obj.type = "json";
                            this.updateCommon(obj, message);
                        }
                    }
                    break;

                case "SubscriptionListener.onSubscriptionStatus":
                    if (this.objects.has(subscriptionId)) {
                        const obj = this.objects.get(subscriptionId);
                        obj.status = params.status;
                        obj.statusMessage = params.message;
                    }
                    break;

                case "SubscriptionListener.onSubscriptionError":
                    this.objects.delete(subscriptionId);
                    break;

                case "StreamLink.createChannel":
                    this.objects.set(subscriptionId, {
                        subject,
                        subscriptionId,
                        params: params,
                        type: "record (channel)",
                        subscriptionTime: message.timestamp,
                        caller: message.caller,
                        lineNumber: message.lineNumber,
                        updateCount: 0,
                        updateTime: "",
                        data: {recordType1: {fields: {}}}
                    });
                    break;
                case "Channel.closeChannel":
                    this.objects.delete(subscriptionId);
                    break;
                case "Channel.sendChannel":
                    if (this.objects.has(subscriptionId)) {
                        let obj = this.getObjectToUpdate(subscriptionId, params.subject);
                        if (obj) {
                            if (params.image) {
                                obj.data.recordType1.fields = params.fields;
                            } else {
                                obj.data.recordType1.fields = {...obj.data.recordType1.fields, ...params.fields};
                            }

                            this.updateCommon(obj, message);
                        }
                    }
                    break;
                case "Channel.sendChannelWithFieldList":
                    if (this.objects.has(subscriptionId)) {
                        let obj = this.getObjectToUpdate(subscriptionId, params.subject);

                        if (obj) {
                            const fieldsMap = {};
                            for (const tuple of params.fieldlist) {
                                fieldsMap[tuple.x] = tuple.y;
                            }
                            if (params.image) {
                                obj.data.recordType1.fields = fieldsMap;
                            } else {
                                obj.data.recordType1.fields = {...obj.data.recordType1.fields, ...fieldsMap};
                            }

                            this.updateCommon(obj, message);
                        }
                    }
                    break;

                case "ChannelListener.onChannelData":
                    if (this.objects.has(subscriptionId)) {
                        let obj = this.getObjectToUpdate(subscriptionId, params.subject);
                        if (obj) {
                            if (params.image) {
                                obj.data.recordType1.fields = params.fields;
                            } else {
                                obj.data.recordType1.fields = {...obj.data.recordType1.fields, ...params.fields};
                            }

                            this.updateCommon(obj, message);
                        }
                    }
                    break;
                case "ChannelListener.onChannelStatus":
                    if (this.objects.has(subscriptionId)) {
                        const obj = this.objects.get(subscriptionId);
                        obj.status = params.status;
                        obj.statusMessage = params.message;
                    }
                    break;
                case "ChannelListener.onChannelError":
                    this.objects.delete(subscriptionId);
                    break;

                case "StreamLink.createJsonChannel":
                    this.objects.set(subscriptionId, {
                        subject,
                        subscriptionId,
                        params: params,
                        type: "json (channel)",
                        subscriptionTime: message.timestamp,
                        caller: message.caller,
                        lineNumber: message.lineNumber,
                        updateCount: 0,
                        updateTime: "",
                        data: {json: {}}
                    });
                    break;
                case "JsonChannel.closeChannel":
                    this.objects.delete(subscriptionId);
                    break;
                case "JsonChannel.sendChannel":
                    if (this.objects.has(subscriptionId)) {
                        let obj = this.getObjectToUpdate(subscriptionId, params.subject);
                        if (obj) {
                            obj.data.json = params.json;
                            this.updateCommon(obj, message);
                        }
                    }
                    break;

                case "JsonChannelListener.onChannelData":
                    if (this.objects.has(subscriptionId)) {
                        let obj = this.getObjectToUpdate(subscriptionId, params.subject);
                        if (obj) {
                            obj.data.json = params.json;
                            this.updateCommon(obj, message);
                        }
                    }
                    break;
                case "JsonChannelListener.onChannelStatus":
                    if (this.objects.has(subscriptionId)) {
                        const obj = this.objects.get(subscriptionId);
                        obj.status = params.status;
                        obj.statusMessage = params.message;
                    }
                    break;
                case "JsonChannelListener.onChannelError":
                    this.objects.delete(subscriptionId);
                    break;

                // default:
                //     console.log("unhandled message: ", message);
            }
        }
    }

    getObjectToUpdate(subscriptionId, subject) {
        let obj = this.objects.get(subscriptionId);
        if (obj.type === "container") {
            const elementId = subscriptionId + subject;
            obj = this.objects.get(elementId);
        }
        return obj;
    }

    getSubscriptions() {
        const subscriptions = [];
        for (let key of this.objects.keys()) {
            const v = this.objects.get(key);
            if (key.indexOf("/") == -1) {
                let elementCount = 0;
                if (v.type === "container") {
                    elementCount = v.data.container.elements.length;
                }
                subscriptions.push({
                    subscriptionId: key,
                    subject: v.subject,
                    params: v.params,
                    type: v.type,
                    updateCount: this.getCombinedUpdateCount(v),
                    updateTime: this.getCombinedUpdateTime(v),
                    subscriptionTime: v.subscriptionTime,
                    elementCount
                })
            }
        }
        return subscriptions;
    }

    getExpandedSubscription(id) {
        const s = this.objects.get(id);
        if (s != undefined && s.type === "container") {
            const data = [];
            for (let i = 0; i < s.data.container.elements.length; i++) {
                const subject = s.data.container.elements[i];
                data.push(this.objects.get(s.subscriptionId + subject));
            }
            const clone = {...s, data: {container: {elements: data}}};
            return clone;
        } else {
            return s;
        }
    }

    updateCommon(obj, message) {
        obj.updateCount++;
        obj.updateTime = message.timestamp;
        if (obj.parentId) {
            let parentObj = this.objects.get(obj.parentId);
            if (parentObj && parentObj.elementUpdateCount !== undefined) {
                parentObj.elementUpdateCount++;
                parentObj.elementUpdateTime = obj.updateTime;
            }
        }
    }

    getCombinedUpdateCount(subscription) {
        if (subscription.elementUpdateCount) {
            return subscription.updateCount + subscription.elementUpdateCount;
        }
        return subscription.updateCount;
    }

    getCombinedUpdateTime(subscription) {
        if (subscription.elementUpdateTime) {
            if (subscription.elementUpdateTime > subscription.updateTime) {
                return subscription.elementUpdateTime;
            } else {
                return subscription.updateTime;
            }
        }
        return subscription.updateTime;
    }

}

class RingBuffer {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.data = [];
        this.p = 0;
        this.count = 0;
    }

    getFirst() {
        if (this.count > this.maxSize) {
            return this.count - this.maxSize;
        } else {
            return 0;
        }
    }

    getLast() {
        return this.count;
    }

    add(element) {
        if (this.data.length < this.maxSize) {
            this.data.push(element);
        } else {
            this.data[this.p] = element;
        }
        this.p = this.inc(this.p);
        this.count++;
        return this.p;
    }

    getRange(a, b) {
        const range = [];
        if (a !== b) {
            a = this.mod(a);
            b = this.mod(b);
            range.push(this.data[a]);
            a = this.inc(a);
            while (a !== b) {
                range.push(this.data[a]);
                a = this.inc(a);
            }
        }
        return range;
    }

    mod(i) {
        if (i >= 0) {
            return i % this.maxSize;
        } else {
            return this.maxSize - (-i % this.maxSize);
        }
    }

    inc(i) {
        return this.mod(i + 1);
    }
}


if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    new Content(false);
} else {
    new Content(true);
}
// new Content(chrome && chrome.storage !== undefined);

