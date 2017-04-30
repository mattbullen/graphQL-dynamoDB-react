import React from "react";

// State management plugin.
import update from "react-addons-update";

// Fetch and Promise polyfills - not strictly needed for the latest version of Chrome, but they don't hurt.
import fetch from "isomorphic-fetch";
import "es6-promise/auto";

// GraphQL browser client.
import { ApolloClient, createNetworkInterface, gql } from "react-apollo";

// Neo4J / GrapheneDB driver.
import neo4j from "../node_modules/neo4j-driver/lib/browser/neo4j-web.min.js";
import v1 from "../node_modules/neo4j-driver/lib/browser/neo4j-web.min.js";

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

import { Querystring } from "request/lib/querystring.js";
Querystring.prototype.unescape = function(val) { return encodeURIComponent(val); };

class App extends React.PureComponent {

    constructor(props) {
        super(props);
        
		// This is a one-time, one-use component. It's not being passed any props from a parent component.
		// In this scenario, simply using its internal state object for everything is simpler and more efficient.
        this.state = {
            client: this.createClient(),
            search: {
                baseID: "2587",
                disabled: true,
                equal: "",
                greater: "",
                lesser: "",
                result: ""
            },
            start: {
                disabled: false
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
				grapheneDB: {
					margin: "10px 40px 0 0",
					width: "150px"
				},
				graphQL: {
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
		this.runGrapheneDB = this.runGrapheneDB.bind(this);
        this.runGraphQL = this.runGraphQL.bind(this);
        this.search = this.search.bind(this);
        this.setID = this.setID.bind(this);
    }

    // Creates an Apollo client to access the GraphQL database.
    createClient() {
        return new ApolloClient({
            networkInterface: createNetworkInterface({
                uri: "https://api.graph.cool/simple/v1/cj216cim9dgby0101l2ca1948"
            })
        });
    }

    // Saves the tuples to the GraphQL database. The tuples are saved in one large string - there is no need to save them
    // individually in this exercise, as they do not change. Also, one string === only one request to the database for all
    // operations / information needed, which saves bandwidth and cuts down on code complexity.
    __saveToGraphQL(tuples) {
        const client = this.state.client;
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
	
	__saveToGrapheneDB(tuples) {                                                                                                       

		const driver = v1.driver("bolt://hobby-fldndcgfojekgbkelnpglgpl.dbs.graphenedb.com:24786", v1.auth.basic("app67579763-cJSBuJ", "b.9G7fygPTCGs1.Kfz6RfH8ZvkK9IkE"), { 
			encrypted: "ENCRYPTION_ON", 
			trust: "TRUST_CUSTOM_CA_SIGNED_CERTIFICATES" 
		});
			
		driver.onError = (error) => {
			console.log("\n", error);
		};
		
		let session = driver.session();
		return session.run("MERGE (n:Tuple {name: {nameParam}}) RETURN n", { nameParam:'Alice' })
					.then((result) => {
						console.log("\nApp.__saveToGrapheneDB() - save node success:", result);
						session.close();
					}).catch((error) => {
						console.log("\nApp.__saveToGrapheneDB() - save node error:", error);
					});
	
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
                    let modKey = prop + "[" + i + "]";
                    if (list[prop.substring(0, modKey.length - 10)]) {
                        list[modKey] = list[prop.substring(0, modKey.length - 10)] + " > " + cur[i].words;
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
        for (key in nums) {
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
            "https://cors-anywhere.herokuapp.com/http://imagenet.stanford.edu/python/tree.py/SubtreeXML?rootid=" + id,
            {
                method: "GET",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                },
                mode: "cors"
            }
        )
        .then((result) => { 
			return result.text();
		}).then((xml) => {
			return (new window.DOMParser()).parseFromString(xml, "text/xml");
		}).then((xml) => {
            // const parsed = app.__xmlToJSON(xml);
            // console.log("\nApp.__scrape(" + id + ") GET:", parsed);
            return app.__xmlToJSON(xml);
        }).catch((error) => {
            console.log("\nApp.__scrape(" + id + ") error:", error);
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
                !!sorted[lut[sorted[i].pid]].children && sorted[lut[sorted[i].pid]].children.push(sorted.splice(i, 1)[0])
                || (sorted[lut[sorted[i].pid]].children = [sorted.splice(i, 1)[0]]);
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

        if (type === "equal") {
            result = tuples.filter(function(o) {
                if (parseInt(newValue, 10)) {
                    return +o.size === +newValue;
                } else {
                    return o.name.indexOf(newValue) !== -1;
                }
            });
            if (result.length < 1 || newValue === "") {
                result = "No matching tuples!";
            } else {
                result = this.__numericSortArray(result, "size");
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
            if (result.length < 1 || newValue === "") {
                result = "No matching tuples!";
            } else {
                result = this.__numericSortArray(result, "size");
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
            if (result.length < 1 || newValue === "") {
                result = "No matching tuples!";
            } else {
                result = this.__numericSortArray(result, "size");
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
            console.log("\nApp.search(" + type + "):", this.state.search);
        });
    }

    // Sorts an array of objects by an object key referring to numeric values.
    __numericSortArray(o, key) {
        return o.sort((a, b) => {
            if (+a[key] > +b[key]) { return -1; }
            if (+a[key] < +b[key]) { return 1; }
            return 0;
        });
    }

    // Formats search results for display.
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

	// Runs the GrapheneDB sequence.
    runGrapheneDB() {
		console.log("\n----- Neo4J / GrapheneDB -----");
		
        new Promise((resolve, reject) => {
            resolve(this.__scrape(this.state.search.baseID));
        }).then((data) => {

            // This provides a buffer in case of promise resolution timing issues. Not strictly needed, but doesn't hurt.
            window.setTimeout(() => {

                // Create the list of tuples in the [{ name: __, size: __ }] format.
                let tuples = this.__merge(this.__flatten(data));
                console.log("\nApp.runGrapheneDB() - scraped tuples:", tuples);

                // Save the tuples to GrapheneDB.
                new Promise((resolve, reject) => {
					resolve(this.__saveToGrapheneDB(tuples))
                }).then((results) => {
					
					console.log("\nApp.runGrapheneDB() - data saved to / returned from GrapheneDB:", results);
				
                }).catch((error) => {
                    console.log("\nApp.runGrapheneDB() - error:", error);
                });

            }, 1000);
        });
    }

    // Runs the GraphQL sequence.
    runGraphQL() {
		console.log("\n----- GraphQL -----");
        new Promise((resolve, reject) => {
            resolve(this.__scrape(this.state.search.baseID));
        }).then((data) => {

            // This provides a buffer in case of promise resolution timing issues. Not strictly needed, but doesn't hurt.
            window.setTimeout(() => {

                // Create the list of tuples in the [{ name: __, size: __ }] format.
                let tuples = this.__merge(this.__flatten(data));
                console.log("\nApp.runGraphQL() - scraped tuples:", tuples);

                // Save the aggregated list to GraphQL as stringified JSON. There is no need to save the tuples individually.
                // Doing so would create an unnecessary performance hit. Note that GraphQL returns the saved list as well.
                // There is no need for a second retrieval action in this exercise, since the tuples list will not change.
                new Promise((resolve, reject) => {
					resolve(this.__saveToGraphQL(tuples))
                }).then((result) => {
                    console.log("\nApp.runGraphQL() - data saved to / returned from GraphQL:", result);
                    const tuplesList = JSON.parse(result.data.createTree.list);

                    // Reassemble the linear list of tuples back into an object.
                    const newTree = this.__reassembleTree(tuplesList);
                    this.__displayJSON(newTree);

                    // Hang onto the graph ID - again, it's not really used much in this exercise, but it would be
                    // in a full app for updating the list of tuples, deletion, etc.
                    const newState = update(this.state, {
                        graphID: { $set: result.data.createTree.id },
                        search: {
                            disabled: { $set: false }
                        },
                        tree: { $set: newTree },
                        tuples: { $set: tuplesList }
                    });
                    this.setState(newState, () => {
                        console.log("\nApp.runGraphQL() - updated component state:", this.state);
                    });

                }).catch((error) => {
                    console.log("\nApp.runGraphQL() - error:", error);
                });

            }, 1000);
        });
    }

	// Renders the DOM.
    render() {
        return (
            <div id="content">

                <div className="row">
                    <h2 className="centered">{"Tuples & Trees"}</h2>
					<h4 className="centered"><em>{"GraphQL with Apollo.js, Neo4J / GrapheneDB with Bolt, and React.js"}</em></h4>
					<ul className="list">
						<li>{"This example is best viewed in the latest version of Chrome. Before starting, please open the developer console to view run time logs."}</li>
						<li>{"Choose between two databases: "}<a href="http://graphql.org/" target="_blank" title="Go to graphql.org?">{"GraphQL"}</a>{" hosted on "}<a href="https://www.graph.cool/" target="_blank" title="Go to graph.cool?">{"GraphCool"}</a>{" and accessed via an "}<a href="http://dev.apollodata.com/" target="_blank" title="View the Apollo.js website?">{"Apollo.js"}</a>{" browser client, or "}<a href="https://www.graphenedb.com/" target="_blank" title="Go to GrapheneDB.com?">{"Neo4J / GrapheneDB"}</a>{" hosted on "}<a href="https://www.heroku.com/" target="_blank" title="Go to heroku.com?">{"Heroku"}</a>{", accessed via a "}<a href="https://developer.mozilla.org/en-US/docs/Web/API/WebSocket" target="_blank" title="Go to the MDN reference page for WebSockets?">{"WebSocket"}</a>{" using the "}<a href="http://boltprotocol.org/v1/" target="_blank" title="View the Bolt protocol website?">{"Bolt protocol"}</a>{"."}</li>
						<li>{"The code for each will scrape the "}<a href="http://imagenet.stanford.edu/synset?wnid=n02486410" target="_blank" title="Go to the Stanford Image Library?">{"Stanford Image Library"}</a>{" for XML nodes, assemble tuples from the scraped XML, store the tuples to the selected database, retrieve them, then assemble and display an object tree."}</li>
						<li>{"Use the search fields below to search for specific tuples. To rerun starting from a different image library root node, enter up to 5 numeric digits in the Root Node ID field, then reselect a database. The base ID for the entire tree is 82127."}</li>
					</ul>
                </div>

                <div className="row centered">

					<MuiThemeProvider muiTheme={muiTheme}>
                        <RaisedButton
                            disabled={this.state.start.disabled}
                            label={"GrapheneDB"}
                            primary={true}
							style={this.state.style.grapheneDB}
							labelStyle={this.state.style.buttons}
                            onClick={this.runGrapheneDB}
                        />
                    </MuiThemeProvider>
					
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
                            floatingLabelText={"Size or Name Equals (String or Int)"}
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