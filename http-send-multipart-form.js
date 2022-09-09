// require in libs
var mustache = require('mustache');
var FileType = require('file-type');
var bent = require('bent');
var FormData = require('form-data');
const {
	Stream
} = require('stream');
var request = require('request');
// require in libs
var debug = false;

module.exports = function (RED) {

	function httpSendMultipart(n) {
		RED.nodes.createNode(this, n);
		var node = this;

		this.ret = n.ret || "txt";

		if (RED.settings.httpRequestTimeout) {
			this.reqTimeout = parseInt(RED.settings.httpRequestTimeout) || 60000;
		} else {
			this.reqTimeout = 60000;
		}

		this.on("input", async function (msg) {
			try {
				var nodeUrl = n.url;
				if (!nodeUrl) {
					nodeUrl = msg.url;
				}
				var isTemplatedUrl = (nodeUrl || "").indexOf("{{") != -1;

				if (msg.debug !== undefined) {
					debug = msg.debug;
				}

				if (debug) {
					if (msg.payload.formOptions !== undefined) {
						for (x in msg.payload.formOptions) {
							console.log(x + "->" + msg.payload.formOptions[x]);
						}
					}
				}

				node.status({
					fill: "blue",
					shape: "dot",
					text: "Sending multipart request..."
				});
				var url = nodeUrl;

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

				if (this.credentials && this.credentials.user) {
					var urlTail = url.substring(url.indexOf('://') + 3);
					var username = this.credentials.user,
						password = this.credentials.password;
					url = 'https://' + username + ':' + password + '@' + urlTail;
				}

				var formData = new FormData();
				var buffer = Buffer.from(''),
					fileName = '',
					fileMime = 'unknown',
					fileDataType;

				if (msg.payload.file.name !== undefined) {
					fileName = msg.payload.file.name;
				}

				fileDataType = n.filetype;
				if (msg.payload.file.type !== undefined) {
					fileDataType = msg.payload.file.type;
				}
				if (debug) console.log("fileDataType: " + fileDataType);

				if (fileDataType !== 'base64' && fileDataType !== 'binary') {
					node.error(RED._("node-red-contrib-send-form .errors.no-file-data-type") + " [" + fileDataType + "]", msg); //   
					node.status({
						fill: "red",
						shape: "ring",
						text: (RED._("node-red-contrib-send-form .errors.no-file-data-type") + " [" + fileDataType + "]")
					});
					return;
				}

				if (debug) console.log("msg.payload.file.data " + msg.payload.file.data.length);

				if (msg.payload.file.data !== undefined && msg.payload.file.data !== '') {
					if (fileDataType === 'base64')
						buffer = Buffer.from(msg.payload.file.data, 'base64');
					else
						buffer = msg.payload.file.data;
				}

				if (debug) console.log('Buffer initial: ' + buffer);
				var fileTypeInfo = buffer !== undefined ? await FileType.fromBuffer(buffer) : undefined;
				if (debug) console.log('fileTypeInfo: ' + fileTypeInfo);
				fileMime = fileTypeInfo !== undefined ? fileTypeInfo.mime : 'application/octet-stream';
				if (fileTypeInfo !== undefined) {
					fileName += "." + fileTypeInfo.ext;
				}

				if (debug) console.log(url);

				if (msg.payload.formOptions !== undefined) {
					for (x in msg.payload.formOptions) {
						if (debug) console.log(x + "->" + msg.payload.formOptions[x]);
						formData.append(x, msg.payload.formOptions[x]);
					}
				}

				var formFileField = msg.payload.file.field;
				if (debug) console.log('contentType ' + fileMime + ' filename ' + fileName);

				formData.append(formFileField, buffer, {
					'contentType': fileMime,
					'filename': fileName
				});

				if (n.sendrequest) {
					try {
						var hearders = formData.getHeaders();
						for (var name in msg.headers) {
							hearders[name] = msg.headers[name];
						}
						if (debug) console.log(hearders);
						switch (n.ret) {
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

						node.error(error);
						console.log(error);
					}

				} else {
					formData.submit(url,
						function (err, res) {
							if (err || !res) {
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

								node.error(err);
							} else {
								res.resume();

								let body = [];
								res.on('data', (chunk) => {
									if (debug) console.log(`BODY: ${chunk}`);
									body.push(chunk);
								});

								res.on('end', () => {
									if (debug) console.log('No more data in response.');

									if (debug) console.log("msg.statusCode " + res.statusCode);

									if (res.statusCode !== 200) {
										if (debug) console.log("msg.statusCode " + res.statusCode);
										node.status({
											fill: "red",
											shape: "ring",
											text: (RED._("node-red-contrib-send-form.errors.error-status-code") + " [" + res.statusCode + "]")
										});
									} else {
										if (debug) console.log("msg.statusCode " + res.statusCode);
										node.status({});
									}

									body = Buffer.concat(body);

									switch (n.ret) {
										case 'bin': {
											msg.payload = body;
											break;
										}
										case 'obj': {

											switch (res.headers["content-type"]) {
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

			} catch (error) {
				node.status({
					fill: "red",
					shape: "ring",
					text: error.message
				});
				node.error(error);
				console.log(error);
			}
		});
	}

	RED.nodes.registerType("http-send-multipart-form-v4", httpSendMultipart, {
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