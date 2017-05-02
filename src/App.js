import React from "react";

// State management plugin.
import update from "react-addons-update";

// Fetch and Promise polyfills - not strictly needed for the latest version of Chrome, but they don't hurt.
import fetch from "isomorphic-fetch";
import "es6-promise/auto";

// GraphQL browser client.
import { ApolloClient, createNetworkInterface, gql } from "react-apollo";

// AWS SDK.
import AWS from "aws-sdk";

// Work around for deprecated Node function used by several dependencies.
import { Querystring } from "request/lib/querystring.js";
Querystring.prototype.unescape = function(value) { return window.encodeURIComponent(value); };

// Needed for onTouchTap.
// http://stackoverflow.com/a/34015469/988941
import injectTapEventPlugin from "react-tap-event-plugin";
injectTapEventPlugin();

// Component CSS.
import "./App.css";

// Material UI components need a theme provider for some of their CSS.
import MuiThemeProvider from "material-ui/styles/MuiThemeProvider";
import getMuiTheme from "material-ui/styles/getMuiTheme";
const muiTheme = getMuiTheme({
    fontFamily: "'Open Sans', Arial, sans-serif",
    raisedButton: {
        primaryColor: "#448aff",
        secondaryColor: "#448aff"
    }
});

// Material UI components.
import RaisedButton from "material-ui/RaisedButton";
import TextField from "material-ui/TextField";

class App extends React.PureComponent {

    constructor(props) {
        super(props);
        
        // "App" is a one-time, one-use component. It's not being passed any props from a parent component.
        // In this scenario, simply using its internal state object for everything is simpler and more efficient.
        this.state = {
            apollo: this.startApolloClient(),
            aws: {
                env: {},
                tuples: []
            },
            search: {
                baseID: "82127",
                disabled: true,
                equal: "",
                greater: "",
                lesser: "",
                result: ""
            },
            start: {
                disabled: true
            },
            style: {
                buttons: {
                    fontSize: "16px",
                    textTransform: "none"
                },
                color: {
                    borderColor: "#448aff",
                    color: "#448aff"
                },
                dynamoDB: {
                    width: "150px"
                },
                graphQL: {
                    margin: "10px 40px 0 0",
                    width: "150px"
                },
                id: {
                    float: "left",
                    marginRight: "40px",
                    width: "100px"
                },
                last: {
                    float: "left",
                    width: "254px"
                },
                text: {
                    float: "left",
                    marginRight: "40px",
                    width: "253px"
                }
            }
        };

        // Binds the DOM event functions to the DOM components.
        this.runDynamoDB = this.runDynamoDB.bind(this);
        this.runGraphQL = this.runGraphQL.bind(this);
        this.search = this.search.bind(this);
        this.setID = this.setID.bind(this);
    }
    
    // Sets the AWS environment variables. This isn't a standard approach. I wanted to see
    // if it could be done this way (seems to work fine). A production approach would be to use
    // one of AWS's user management frameworks, such as Federated Identities.
    componentDidMount() {
        const app = this;
        fetch("https://tree-tuples-cors-proxy.herokuapp.com/http://www.matthewbullen.net/misc/string.php", { 
            method: "GET", 
            headers: { 
                "Origin": "https://tree-tuples.herokuapp.com"
            },
            mode: "cors"
        }).then((response) => { 
            return response.arrayBuffer();
        }).then((buffer) => { 
            let u8, parsed;
            u8 = new Uint8Array(buffer);
            parsed = String.fromCharCode.apply(String, u8);
            parsed = window.atob(parsed).split("*");
            const newState = update(app.state, {
                aws: {
                    env: { 
                        a: { $set: window.btoa(parsed[0]) },
                        b: { $set: window.btoa(parsed[1]) },
                        r: { $set: window.btoa("us-west-2") }
                    }
                },
                start: {
                    disabled: { $set: false }
                }
            });
            app.setState(newState, () => {})
        }).catch((error) => {
            console.error("\nApp.componentDidMount() - error:", error);
        });
    }
    
    // Creates an Apollo client to access the GraphQL database. In production code, the URI would be hidden 
    // in a process.env variable. That isn't done here since I used Heroku, and I ran out of time to write 
    // a custom buildpack / Webpack config. Weirdly enough, a standard NPM plugin for accessing those variables 
    // wasn't compatible with this build, either (the "dotenv" plugin).
    startApolloClient() {
        return new ApolloClient({
            networkInterface: createNetworkInterface({
                uri: "https://api.graph.cool/simple/v1/cj216cim9dgby0101l2ca1948"
            })
        });
    }

    // Saves the tuples to GraphQL. For the sake of experimentaton, the tuples are saved as an aggregated 
    // text document: all of the tuples are joined into one large string / document entry. This has limited
    // effect here, but it would be a useful strategy for saving multiple tuple lists as different documents.
    __saveToGraphQL(tuples) {
        const client = this.state.apollo;
        return client.mutate({
            mutation: gql`
                mutation ($list: String!) {
                    createTree(list: $list) {
                        id
                        list
                    }
                }
            `,
            variables: {
                list: JSON.stringify(tuples)
            }
        }).then((result) => {
            console.log("\nApp.__saveToGraphQL() - success:", result);
            return result;
        }).catch((error) => {
            console.log("\nApp.__saveToGraphQL() - error:", error);
        });
    }

    // Saves then retrieves the tuples to/from an AWS DynamoDB instance. The tuples are saved as individual table entries.
    // This makes use of DynamoDB's batch transaction feature to limit the number of network requests.
    __saveToDynamoDB(tuples) {                                                                                                       
        const app = this;
        
        const env = Object.assign(this.state.aws.env);
        AWS.config.update({
            region: window.atob(env.r),
            credentials: { 
                accessKeyId: window.atob(env.a), 
                secretAccessKey: window.atob(env.b)
            },
            paramValidation: false
        });
        const client = new AWS.DynamoDB.DocumentClient();
        
        wipe();
        
        // DynamoDB limits you to 25 queries / 16MB at a time.
        if (tuples.length > 25) {
            for (let i = 0; i < tuples.length; i = i + 25) {
                save(i); 
            }
        } else {
            save(0);
        }
        scan();
        return "AWS DynamoDB transactions completed";
        
        // Wipes any previous table entries.
        function wipe() {
            let i, j, deletes;
            for (i = 0; i < 300; i = i + 25) {
                deletes = [];
                for (j = i; j < 25; j++) {
                    deletes.push({
                        "DeleteRequest": {
                            "Key": {
                                "id": "" + j
                            }
                        }
                    });
                    client.batchWrite({
                        RequestItems: { "TupleList": deletes }
                    }, (error, result) => {
                        if (error) {
                            console.error("\nApp.__saveToDynamoDB() - DELETE error:", error);
                        } else {
                            // console.log("\nApp.__saveToDynamoDB() - DELETE success:", result);
                        }
                    });
                }
            }
            console.log("\nApp.__saveToDynamoDB() - DELETE completed");
        }
        
        // The AWS table stores each tuple as a string in a line entry: name***size. There are only
        // two fields in the DynamoDB table (id and the tuple string). It's a small efficiency boost, 
        // since splitting a string in the browser to reassemble the tuples later is cheaper, in terms 
        // of resources, than having another table field that would increase the table size, which AWS
        // would charge you for. Another field would be needed if the table needed to be searchable by 
        // either tuple key, but here we're saving and retrieving the tuples unmodified.
        function save(startIndex) {
            let i, item, puts = [];
            for (i = startIndex; i < startIndex + 25; i++) {
                item = tuples[i];
                if (!item) { break; }
                puts.push({
                    "PutRequest": {
                        "Item": {
                            "id": "" + i,
                            "tuple": item.name + "***" + item.size
                        }
                    }
                 });
            }
            client.batchWrite({
                RequestItems: { "TupleList": puts }
            }, (error, result) => {
                if (error) {
                    console.error("\nApp.__saveToDynamoDB() - PUT error:", error);
                } else {
                    console.log("\nApp.__saveToDynamoDB() - PUT success:", result);
                }
            });
        }
        
        // Retrieves all saved tuples from DynamoDB in a batch transaction.
        function scan() {
            client.scan({
                TableName: "TupleList"
            }, (error, result) => {
                if (error) {
                    console.error("\nApp.__saveToDynamoDB() - GET error:", error);
                } else {
                    let list = Array.from(app.state.aws.tuples);
                    const newState = update(app.state, {
                        aws: {
                            tuples: { $set: list.concat(result.Items) }
                        }
                    });
                    app.setState(newState, () => {
                        console.log("\nApp.__saveToDynamoDB() - GET success:", app.state);
                    });
                }
            });
        }
    }

    // Takes the AWS-formatted tuples and converts them back to their original format.
    __assembleTuplesFromDynamoDB() {
        let i, item, rawTuples = Array.from(this.state.aws.tuples), finalTuples = [];
        for (i = 0; i < rawTuples.length; i++) {
            item = Object.assign(rawTuples[i]).tuple.split("***");
            finalTuples.push({
                name: item[0],
                size: item[1]
            });
        }
        return finalTuples;
    }
    
    // Creates the tuple names ("a > b > etc.") and image counts.
    __flatten(data) {
        var result = {};
        var list = {};
        function recurse (cur, prop) {
            if (Object(cur) !== cur) {
                if (prop.indexOf("num_finalgood") !== -1) {
                    result[prop.replace(".num_finalgood", "")] = cur;
                }
            } else if (Array.isArray(cur)) {
                for (let i = 0; i < cur.length; i++) {
                    let ii;
                    if (i < 10) { 
                        ii = "000" + i;
                    } else if (i > 9 && i < 100) {
                        ii = "00" + i;
                    } else if (i > 99 && i < 1000) {
                        ii = "0" + i;
                    } else {
                        ii = i;
                    }
                    let modKey = prop + "[" + ii + "]";
                    if (list[prop.substring(0, modKey.length - 13)]) {
                        list[modKey] = list[prop.substring(0, modKey.length - 13)] + " > " + cur[i].words;
                    } else {
                        list[modKey] = cur[i].words;
                    }
                    recurse(cur[i], modKey);
                }
            } else {
                let empty = true;
                for (let p in cur) {
                    empty = false;
                    recurse(cur[p], prop ? prop + "." + p : p);
                }
                if (empty && prop) {
                    result[prop] = {};
                }
            }
        }
        recurse(data, "");
        return [result, list];
    }

    // Assembles the tuples in the [{ name: __, size: __ }] format.
    __merge(data) {
        let result = [];
        let nums = data[0];
        let names = data[1];
        let key;
        for (key in names) {
            result.push({
                name: names[key],
                size: nums[key]
            });
        }
        return result;
    }

    // Scrapes the site for raw XML nodes. It uses a free proxy to get around CORS issues (and to enforce HTTPS).
    __scrape(id) {
        const app = this;
        return fetch(
            "https://tree-tuples-cors-proxy.herokuapp.com/http://imagenet.stanford.edu/python/tree.py/SubtreeXML?rootid=" + id,
            {
                method: "GET",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Origin": "https://tree-tuples.herokuapp.com"
                },
                mode: "cors"
            }
        )
        .then((result) => { 
            return result.text();
        }).then((xml) => {
            return (new window.DOMParser()).parseFromString(xml, "text/xml");
        }).then((xml) => {
            // console.log("\nApp.__scrape(" + id + ") - GET:", app.__xmlToJSON(xml));
            return app.__xmlToJSON(xml);
        }).catch((error) => {
            console.error("\nApp.__scrape(" + id + ") - error:", error);
        });
    }

    // Parses the site's XML nodes into JSON-friendly object format.
    __xmlToJSON(xml) {
        if (!this.scraped) { this.scraped = []; }
        let attribute, i, j, item, id;
        var o = {
            synset: []
        };
        if (xml.nodeType === 1 && xml.nodeName !== "#document" && xml.attributes.length > 0) {
            for (i = 0; i < xml.attributes.length; i++) {
                attribute = xml.attributes.item(i);
                o[attribute.nodeName] = attribute.nodeValue;
            }
            id = o["synsetid"];
            if (id && this.scraped.indexOf(id) < 0) {
                this.scraped.push(id);
                if (o["num_children"] && +o["num_children"] > 0) {
                    new Promise((resolve, reject) => {
                        resolve(this.__scrape(id));
                    }).then((data) => {
                        if (+data.synset[0].synsetid !== +this.state.search.baseID) {
                            o.synset.push(data.synset[0]);
                        }
                    });
                }
            }
        }
        if (xml.hasChildNodes()) {
            for (j = 0; j < xml.childNodes.length; j++) {
                item = xml.childNodes.item(j);
                o.synset.push(this.__xmlToJSON(item));
            }
        }
        return o;
    }

    // Used by __xmlToJSON(), above, to construct the tree object.
    __construct(o) {
        let lut = {};
        function sort(a) {
            let len = a.length, fix = -1, i;
            for (i = 0; i < len; i++) {
                while (!!~(fix = a.findIndex(e => a[i].pid === e.id)) && fix > i) {
                    [a[i], a[fix]] = [a[fix], a[i]];
                }
                lut[a[i].id] = i;
            }
            return a;
        }
        let i, sorted = sort(o.slice(0));
        for (i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i].pid !== "root") {
                try {
                    (!!sorted[lut[sorted[i].pid]].children && sorted[lut[sorted[i].pid]].children.push(sorted.splice(i, 1)[0]))
                    || (sorted[lut[sorted[i].pid]].children = [sorted.splice(i, 1)[0]]);
                } catch(error) {}  
            }
        }
        return JSON.parse(JSON.stringify(sorted, (k, v) => (k === "id" || k === "pid") ? undefined : v));
    }

    // Reassembles a tree object from the linear list of tuples.
    __reassembleTree(list) {
        let i, name, pid, pidList = [];
        for (i = 0; i < list.length; i++) {
            name = list[i].name.split(">");
            if (name.length > 1) {
                pid = name.slice(0, -1);
                pid = pid.join(">").trim();
            } else {
                pid = "root";
            }
            pidList.push({
                name: name[name.length - 1].trim(),
                size: list[i].size,
                id: list[i].name,
                pid: pid
            })
        }
        return this.__construct(pidList);
    }

    // Search the list of tuples. This is a linear (N) search.
    search(e, newValue) {
        e.persist();
        e.preventDefault();
        e.stopPropagation();

        const type = e.target.id;
        if (type === "lesser" || type === "greater") {
            newValue = newValue.replace(/[^0-9]+/gi, "");
        }

        const tuples = Array.from(this.state.tuples);
        let newState, result;

        // The "equals" search allows exact matching as well as single term / "OR" matching
        // in the case of multiple search terms. The terms can be separated by spaces, ">" or commas.
        if (type === "equal") {
            result = tuples.filter(function(o) {
                if (parseInt(newValue, 10)) {
                    return +o.size === +newValue;
                } else {
                    newValue = newValue.replace(/\s\s+/g, " ");
                    if (o.name.indexOf(newValue) !== -1) {
                        return true;
                    }
                    let terms;
                    if (newValue.indexOf(">") !== -1) {
                        terms = newValue.split(">");
                    } else if (newValue.indexOf(",") !== -1) {
                        terms = newValue.split(",");
                    } else {
                        terms = newValue.split(" ");
                    }
                    for (let i = 0; i < terms.length; i++) {
                        if (o.name.indexOf(terms[i]) !== -1) {
                            return true;
                        }
                    }
                    return false;
                }
            });
            if (result.length < 1) {
                result = "No matching tuples!";
            } else if (newValue === "") {
                result = Array.from(this.state.tree);
            } else {
                result = this.__numericSortDescending(result, "size");
            }
            newState = update(this.state, {
                search: {
                    equal: { $set: newValue },
                    greater: { $set: "" },
                    lesser: { $set: "" },
                    result: { $set: result }
                }
            });
        }

        if (type === "lesser") {
            result = tuples.filter(function(o) {
                return +o.size < +newValue;
            });
            if (result.length < 1) {
                result = "No matching tuples!";
            } else if (newValue === "") {
                result = Array.from(this.state.tree);
            } else {
                result = this.__numericSortDescending(result, "size");
            }
            newState = update(this.state, {
                search: {
                    equal: { $set: "" },
                    greater: { $set: "" },
                    lesser: { $set: newValue },
                    result: { $set: result }
                }
            });
        }

        if (type === "greater") {
            result = tuples.filter(function(o) {
                return +o.size > +newValue;
            });
            if (result.length < 1) {
                result = "No matching tuples!";
            } else if (newValue === "") {
                result = Array.from(this.state.tree);
            } else {
                result = this.__numericSortDescending(result, "size");
            }
            newState = update(this.state, {
                search: {
                    equal: { $set: "" },
                    greater: { $set: newValue },
                    lesser: { $set: "" },
                    result: { $set: result }
                }
            });
        }

        this.setState(newState, () => {
            this.__displayJSON(result);
            console.log("\nApp.search(" + type + "):", this.state.search.result);
        });
    }

    // Sorts an array of objects by an object key referring to numeric values.
    __numericSortDescending(o, key) {
        return o.sort((a, b) => {
            if (+a[key] > +b[key]) { return -1; }
            if (+a[key] < +b[key]) { return 1; }
            return 0;
        });
    }

    // Formats the assembled object tree for display.
    __formatJSON(json) {
        if (typeof json !== "string") {
            json = JSON.stringify(json, undefined, 5);
        }
        json = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
            (match) => {
                let cls = "number";
                if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                        cls = "key";
                    } else {
                        cls = "string";
                    }
                } else if (/true|false/.test(match)) {
                    cls = "boolean";
                } else if (/null/.test(match)) {
                    cls = "null";
                }
                return '<span class="' + cls + '">' + match + '</span>';
        });
    }

    // Displays the tuples JSON in div#result.
    __displayJSON(json) {
        document.getElementById("result").innerHTML = this.__formatJSON(json);
    }

    // Allows selection of a different root node ID in the image tree on the Stanford image library site.
    setID(e, newValue) {
        e.persist();
        e.preventDefault();
        e.stopPropagation();
        let disabled;
        let parsed = newValue.replace(/[^0-9]+/gi, "");
        parsed = ("" + parsed).substring(0, 5);
        parsed = parseInt(parsed, 10);
        if (!parsed || parsed === "") {
            parsed = "";
            disabled = true;
        } else {
            disabled = false;
        }
        const newState = update(this.state, {
            search: {
                baseID: { $set: parsed }
            },
            start: {
                disabled: { $set: disabled }
            }
        });
        this.setState(newState, () => {
            console.log("\nApp.setID():", this.state.search.baseID);
        });
    }

    // Reassembles the linear list of tuples back into an object tree, whuich then updates the DOM's display state.
    __tuplesToTree(tuplesList, dbName) {
        const newTree = this.__reassembleTree(tuplesList);
        const newState = update(this.state, {
            search: {
                disabled: { $set: false },
                equal: { $set: "" },
                greater: { $set: "" },
                lesser: { $set: "" },
                result: { $set: [] }
            },
            tree: { $set: newTree },
            tuples: { $set: tuplesList }
        });
        this.setState(newState, () => {
            this.__displayJSON(newTree);
            console.log("\nApp." + dbName + "() - updated app state:", this.state);
        });
    }
    
    // Runs the AWS DynamoDB sequence.
    runDynamoDB() {
        console.log("\n----- AWS DynamoDB -----");
        
        new Promise((resolve, reject) => {
            resolve(this.__scrape(this.state.search.baseID));
        }).then((data) => {

            // This provides a buffer in case of promise resolution timing issues. Not strictly needed, but doesn't hurt.
            window.setTimeout(() => {

                // Create the list of tuples in the [{ name: __, size: __ }] format.
                let flattened = this.__flatten(data);
                let tuples = this.__merge(flattened);
                console.log("\nApp.runDynamoDB() - scraped tuples:", tuples);
                
                new Promise((resolve, reject) => {
                    resolve(this.__saveToDynamoDB(tuples));
                }).then((status) => {
                    
                    // I would rework this in a revised version. The AWS query results are saved to the component's 
                    // state in the Promise above, and React can sometimes be slow to update the state. Instead of
                    // using a time out, a generator or a Promise for an array of queries might be a little more elegant.
                    // The time out has the benefit of being simple and reliable, though.
                    window.setTimeout(() => {
                        console.log("\nApp.runDynamoDB() - updated status:", status);
                        this.__tuplesToTree(this.__assembleTuplesFromDynamoDB(), "DynamoDB");
                    }, (Math.floor(tuples.length / 25) + 1) * 500);
                });
                
            }, 1000);
        }).catch((error) => {
            console.error("\nApp.runDynamoDB() - error:", error);
        });
    }

    // Runs the GraphQL sequence.
    runGraphQL() {
        console.log("\n----- GraphQL -----");
        new Promise((resolve, reject) => {
            resolve(this.__scrape(this.state.search.baseID));
        }).then((data) => {

            // Same promise timing buffer as above.
            window.setTimeout(() => {

                // Create the list of tuples in the [{ name: __, size: __ }] format.
                let flattened = this.__flatten(data);
                let tuples = this.__merge(flattened);
                console.log("\nApp.runGraphQL() - scraped tuples:", tuples);

                // Saves the aggregated list to GraphQL as stringified JSON - it's basically treating the aggregated tuples
                // as a single document. This would be useful in cases where the code needed to save multiple sets of tuples
                // for different tree searches (here, there's only one set). Note that GraphQL returns the saved list as well. 
                // There is no need for a second retrieval action - it would have the same result.
                new Promise((resolve, reject) => {
                    resolve(this.__saveToGraphQL(tuples))
                }).then((result) => {
                    console.log("\nApp.runGraphQL() - data saved to / returned from GraphQL:", result);
                    this.__tuplesToTree(JSON.parse(result.data.createTree.list), "GraphQL");
                }).catch((error) => {
                    console.error("\nApp.runGraphQL() - error:", error);
                });
            }, 1000);
        }).catch((error) => {
            console.error("\nApp.runGraphQL() - error:", error);
        });
    }

    // Renders the DOM.
    render() {
        return (
            <div id="content">

                <div className="row">
                    <h2 className="centered">{"Tuples & Trees"}</h2>
                    <h4 className="centered"><em>{"GraphQL via Apollo.js, DynamoDB via the AWS Web SDK, and React.js"}</em></h4>
                    <ul className="list">
                        <li>{"This example is best viewed in the latest version of Chrome. Before starting, please open the developer console to view run time logs."}</li>
                        <li>{"Choose between two databases: a "}<a href="http://graphql.org/" target="_blank" title="Go to graphql.org?">{"GraphQL"}</a>{" graph hosted on "}<a href="https://www.graph.cool/" target="_blank" title="Go to graph.cool?">{"GraphCool"}</a>{" and accessed via an "}<a href="http://dev.apollodata.com/" target="_blank" title="View the Apollo.js website?">{"Apollo.js"}</a>{" browser client, or an "}<a href="https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html" target="_blank" title="Go to the AWS DynamoDB documentation?">{"AWS DynamoDB"}</a>{" table accessed via the "}<a href="https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/welcome.html" target="_blank" title="View the AWS Web SDK documentation?">{"AWS Web SDK"}</a>{"."}</li>
                        <li>{"Each scrapes the "}<a href="http://imagenet.stanford.edu/synset?wnid=n02486410" target="_blank" title="Go to the Stanford Image Library?">{"Stanford Image Library"}</a>{" for XML nodes, parses tuples from the scraped XML, stores the tuples to the selected database, retrieves them, then assembles and displays an object tree."}</li>
                        <li>{"Use the fields below to search for specific tuples. To rerun starting from a different image library root node, enter up to 5 numeric digits in the Root Node ID field, then reselect a database. The base ID for the entire tree is 82127."}</li>
                    </ul>
                </div>

                <div className="row centered">

                    <MuiThemeProvider muiTheme={muiTheme}>
                        <RaisedButton
                            disabled={this.state.start.disabled}
                            label={"GraphQL"}
                            primary={true}
                            style={this.state.style.graphQL}
                            labelStyle={this.state.style.buttons}
                            onClick={this.runGraphQL}
                        />
                    </MuiThemeProvider>

                    <MuiThemeProvider muiTheme={muiTheme}>
                        <RaisedButton
                            disabled={this.state.start.disabled}
                            label={"DynamoDB"}
                            primary={true}
                            style={this.state.style.dynamoDB}
                            labelStyle={this.state.style.buttons}
                            onClick={this.runDynamoDB}
                        />
                    </MuiThemeProvider>
                    
                </div>

                <div className="row">

                    <MuiThemeProvider muiTheme={muiTheme}>
                        <TextField
                            value={this.state.search.baseID}
                            type={"text"}
                            fullWidth={false}
                            floatingLabelText={"Root Node ID"}
                            floatingLabelFocusStyle={this.state.style.color}
                            underlineFocusStyle={this.state.style.color}
                            style={this.state.style.id}
                            onChange={this.setID}
                            ref="setID"
                            id="setID"
                        />
                    </MuiThemeProvider>

                    <MuiThemeProvider muiTheme={muiTheme}>
                        <TextField
                            disabled={this.state.search.disabled}
                            value={this.state.search.lesser}
                            type={"text"}
                            fullWidth={false}
                            floatingLabelText={"Size Less Than (Int)"}
                            floatingLabelFocusStyle={this.state.style.color}
                            underlineFocusStyle={this.state.style.color}
                            style={this.state.style.text}
                            onChange={this.search}
                            ref="searchLesser"
                            id="lesser"
                        />
                    </MuiThemeProvider>

                    <MuiThemeProvider muiTheme={muiTheme}>
                        <TextField
                            disabled={this.state.search.disabled}
                            value={this.state.search.greater}
                            type={"text"}
                            fullWidth={false}
                            floatingLabelText={"Size Greater Than (Int)"}
                            floatingLabelFocusStyle={this.state.style.color}
                            underlineFocusStyle={this.state.style.color}
                            style={this.state.style.text}
                            onChange={this.search}
                            ref="searchGreater"
                            id="greater"
                        />
                    </MuiThemeProvider>

                    <MuiThemeProvider muiTheme={muiTheme}>
                        <TextField
                            disabled={this.state.search.disabled}
                            value={this.state.search.equal}
                            type={"text"}
                            fullWidth={false}
                            floatingLabelText={"Size or Name Equals (Int or String)"}
                            floatingLabelFocusStyle={this.state.style.color}
                            underlineFocusStyle={this.state.style.color}
                            style={this.state.style.last}
                            onChange={this.search}
                            ref="searchEqual"
                            id="equal"
                        />
                    </MuiThemeProvider>

                </div>

                <div className="row">
                    <div id="result"></div>
                </div>

            </div>
        );
    }
}

export default App;