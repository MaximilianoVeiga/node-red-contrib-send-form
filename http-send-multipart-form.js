// require in libs
var mustache = require('mustache');
var FileType = require('file-type');
var bent = require('bent');
var FormData = require('form-data');
const {Stream} = require('stream');
var request = require('request');
// require in libs

var fileData = ""; // initializing file
var debug = false; 

module.exports = function (RED) {

	function httpSendMultipart(n) {
		// Setup node
		RED.nodes.createNode(this, n);
		var node = this;

		this.ret = n.ret || "txt"; // default return type is text
		if (RED.settings.httpRequestTimeout) {
			this.reqTimeout = parseInt(RED.settings.httpRequestTimeout) || 60000;
		} else {
			this.reqTimeout = 60000;
		}

		// 1) Process inputs to Node
		this.on("input", async function (msg) {
			// TODO: add ability to select other input types (not just files)
			
			// Load 'url' parameter from node and try msg as failover
			var nodeUrl = n.url;
				if(!nodeUrl) {
					nodeUrl = msg.url;
				}
				var isTemplatedUrl = (nodeUrl || "").indexOf("{{") != -1;
			
			if(msg.debug !== undefined) {
				debug = msg.debug;
			}

			if(debug) {	
				if(msg.payload.formOptions !== undefined) {
					for (x in msg.payload.formOptions) {
						console.log(x + "->" + msg.payload.formOptions[x]);
					}
				}
			}

			if (!msg.payload.file.data) {
				// throw an error if no file
				node.warn(RED._("Error: no file found to send."));
				msg.error = "File was not defined";
				msg.statusCode = 400;
				node.send(msg); // TODO: make sure this escapes entirely; need better error-handling here
			} else {
				fileData = msg.payload.file.data;
			}
				node.status({
					fill: "blue",
					shape: "dot",
					text: "Sending multipart request..."
				});
				var url = nodeUrl; // TODO add ability to take this from the settings.js config file
				
				if (isTemplatedUrl) {
					url = mustache.render(nodeUrl, msg);
				}
				
				if (!url) {
					node.error(RED._("httpSendMultipart.errors.no-url"), msg);
					node.status({
						fill: "red",
						shape: "ring",
						text: (RED._("httpSendMultipart.errors.no-url"))
					});
					return;
				}

				// Add auth if it exists
				if (this.credentials && this.credentials.user) {
					var urlTail = url.substring(url.indexOf('://') + 3); // hacky but it works. don't judge me
					var username = this.credentials.user,
					password = this.credentials.password;
					url = 'https://' + username + ':' + password + '@' + urlTail;
				}

				

				var formData = new FormData();
				var buffer, fileName = 'default', fileMime = 'unknown', fileDataType;
				
				/*
				// Payload Format
				msg.payload = {
					file: {
						field: 'file',
						data: msg.payload,
						type: 'binary',
						name: 'test'
					},
					formOptions: {
						params: '',
					}
				}


				*/



				if(msg.payload.file.name !== undefined) {
					fileName = msg.payload.file.name;
				}	
				
				fileDataType = n.filetype;
				if(msg.payload.file.type !== undefined) {
					fileDataType = msg.payload.file.type;
				}
				if(debug) console.log("fileDataType: "+fileDataType);

				if (fileDataType !== 'base64' && fileDataType !== 'binary'){
					node.error(RED._("node-red-contrib-send-form .errors.no-file-data-type") + " ["+fileDataType+"]", msg); //   
					node.status({
						fill: "red",
						shape: "ring",
						text: (RED._("node-red-contrib-send-form .errors.no-file-data-type") + " ["+fileDataType+"]")
					});
					return;
				}	
				
				if(debug) console.log("msg.payload.file.data " +msg.payload.file.data.length);
			
				if(msg.payload.file.data !== undefined) {
				{
					if (fileDataType === 'base64')
						buffer = Buffer.from(msg.payload.file.data, 'base64');
					else
						buffer = msg.payload.file.data;
				}
				
				var fileTypeInfo = await FileType.fromBuffer(buffer);
				fileMime = fileTypeInfo.mime;
				fileName += "."+fileTypeInfo.ext;

				if(debug) console.log(fileTypeInfo);
				if(debug) console.log(url);

				if(msg.payload.formOptions !== undefined) {
					for (x in msg.payload.formOptions) {
						if(debug) console.log(x + "->" + msg.payload.formOptions[x]);
						formData.append(x, msg.payload.formOptions[x]);
					}
				}

				var formFileField = msg.payload.file.field;
				if(debug) console.log(formFileField + " "+msg.payload.file.data.length+" "+buffer.length);
				if(debug) console.log('contentType '+ fileMime + ' filename '+ fileName);


				formData.append(formFileField, buffer, { 	// 'photo'
					'contentType': fileMime, 				//'image/png',
					'filename': fileName
				});

				if(n.sendrequest) {
					try {
						var hearders = formData.getHeaders();
						for(var name in msg.headers) {
							hearders[name] = msg.headers[name];
						}
						if(debug) console.log(hearders);
						switch(n.ret) {
							case 'bin': {
								var post = bent(url, 'POST', 'buffer', hearders);
								var response = await post('', formData.getBuffer());
								msg.payload = await response.buffer();
								break;
							}
							case 'obj': {
								var post = bent(url, 'POST', 'json', hearders);
								var response = await post('', formData.getBuffer());
								msg.payload = await response.json();
								break;
							}
							default: {
								var post = bent(url, 'POST', 'string', hearders);
								var response = await post('', formData.getBuffer());
								msg.payload = response;								
								break;
							}
						}
						node.status({});
						node.send(msg);
					} catch (error) {
						node.status({
							fill: "red",
							shape: "ring",
							text: error.message
						});
						console.log(error);
					}
					
				} else {
					formData.submit(url,
						function (err, res) {
	
						if (err || !res) {
							// node.error(RED._("httpSendMultipart.errors.no-url"), msg);
							var statusText = "Unexpected error";
							if (err) {
								statusText = err.message;
							} else if (!res) {
								statusText = "No response object";
							}
							node.status({
								fill: "red",
								shape: "ring",
								text: statusText
							});
						// success
						} else {
							res.resume();
	
							// get body of response object
							let body = [];
							res.on('data', (chunk) => {
								if(debug) console.log(`BODY: ${chunk}`);
								body.push(chunk);
							  });
	
							  res.on('end', () => {
								if(debug) console.log('No more data in response.');
	
								if(debug) console.log("msg.statusCode "+res.statusCode);
	
								if(res.statusCode !== 200){
									if(debug) console.log("msg.statusCode "+res.statusCode);
									node.status({
										fill: "red",
										shape: "ring",
										text: (RED._("node-red-contrib-send-form.errors.error-status-code") + " ["+res.statusCode+"]")
									});
								} else {
									if(debug) console.log("msg.statusCode "+res.statusCode);
									node.status({
									});
								}
	
								body = Buffer.concat(body);
	
								switch(n.ret) {
									case 'bin': {
										msg.payload = body;
										break;
									}
									case 'obj': {
	
										// check content-type
										switch(res.headers["content-type"]) {
											case 'application/json':
											case 'application/json; charset=utf-8': {
												body = JSON.parse(body);
												break;
											}
										}
	
										msg.payload = {
											body: body,
											headers: res.headers,
											statusCode: res.statusCode
										};
										break;
									}
									default: {
										msg.payload = body.toString();
									}
								}
								
								node.send(msg);
							  });  						
						}
					});
				}
			} //else
		}); // end of on.input
	} // end of httpSendMultipart fxn

	// Register the Node
	RED.nodes.registerType("http-send-multipart-form-v3", httpSendMultipart, {
		credentials: {
			user: {
				type: "text"
			},
			password: {
				type: "password"
			}
		}
	});

}; // end module.exports
