var sdb = require('simpledb');
var uuid = require('node-uuid');

module.exports = function(config) {
	this.config = config;
	this.config.before_create = this.config.before_create ||
	function(args, done) {
		done(args.data);
	}
	this.config.after_create = this.config.after_create ||
	function(args, done) {

	}
	this.config.permissions = this.config.permissions || {
		default_write: 'null',
		default_read: '*',
	}
	this.sdb = this.config.db || new sdb.SimpleDB({
		keyid: config.keyid,
		secret: config.secret
	});
	var self = this;

	function arrayify(st) {
		try {
			if (typeof(st) == 'string') {
				if ((st.charAt(0) == '(') && (st.charAt(st.length - 1) == ')')) {
					return JSON.parse('[' + st.substr(1, st.length - 2) + ']');
				}
				return [st]
			}
			return st
		} catch (e) {
			return []
		}
	}
	this.sync = function(req, res, next) {
		return self._sync(req, res, next)
	}
	this._sync = function(req, res, next, done, originalUrl, body) {
		//if done is passed, the function will not use res to return/close the http connection.
		//done is used by other internal functions that want to talk to the sync engine without
		//making an http call (it's effectively an rpc call)
		if ((req.method == 'POST') || (req.method == 'PUT')) {
			var params = (body || req.body);
		} else {
			var params = req.query;
		}

		function can_update(d, i, if_so) { //this function runs if_so if the current user can access and update (i) within the (d) domain.
			self.sdb.getItem(d, i, function(error, result) {
				if (error) {
					if (done) {
						done(error, result);
					} else {
						res.json({
							type: 'error',
							msg: error.Message || 'bad query'
						})
					}
					return
				}
				if (!result) {
					if (done) {
						done({
							Message: 'requested item does not exist.'
						}, result);
					} else {
						res.json({
							type: 'error',
							msg: 'requested item does not exist.'
						})
					}
					return
				}
				//check if the user who is asking for it actually has permission to read this.
				if ((result.write_access == '*') || (result.owner == req.user._id) || (result.write_access.indexOf(req.user._id) != -1)) {
					if_so(result);
				} else {
					if (done) {
						done({
							Message: 'permission denied.'
						}, result);
					} else {
						res.json({
							type: 'error',
							msg: 'permission denied.'
						})
					}
				}
			});
		}
		if (req.route.path.indexOf('*') != req.route.path.length - 1) {
			throw new Error('sdb-bb requires a dedicated path that is defined by something/*');
		}
		var path = (originalUrl || req.originalUrl).split(req.route.path.split('*')[0])[1];
		//check if collection_name includes "/". This is useful for hierarchical data.
		//The format is:
		// 1- something/collection_name 
		// 2- somehing/parent_collection_name/sub_collection_name
		var collection_name = path.split('/')[0].split('?')[0];
		var rest_of_url = (originalUrl || req.originalUrl).split(collection_name)[1];
		var requested_id = rest_of_url.substr(0, 1) == '/' ? rest_of_url.split('/')[1].split('?')[0] : null;
		if (requested_id && !(new RegExp('^([abcdef]|[0-9]){8}-([abcdef]|[0-9]){4}-([abcdef]|[0-9]){4}-([abcdef]|[0-9]){4}-([abcdef]|[0-9]){12}$')).test(requested_id)) {
			if (done) {
				done({
					Message: 'the id is not valid.'
				}, result);
			} else {
				res.json({
					type: 'error',
					msg: 'the id is not valid.'
				});
			}
			return
		}
		if (requested_id) {
			var parent_collection_name = collection_name;
			collection_name = collection_name + '/' + requested_id;
		} else {
			var parent_collection_name = null;
		}
		var domain = null;
		var parent_domain = null;
		for (var i in self.config.domains) {
			if ((new RegExp(i)).test(collection_name)) {
				domain = self.config.domains[i];
				break
			}
		}
		if (parent_collection_name) { //only meaningful for objects that have parents.
			for (var i in self.config.domains) {
				if ((new RegExp(i)).test(parent_collection_name)) {
					parent_domain = self.config.domains[i];
					break
				}
			}
		}
		if (!domain) {
			throw new Error('the backbone collection ' + collection_name + ' is not defined as a valid collection in config.domains.');
		}
		if (parent_collection_name && !parent_domain) {
			throw new Error('the backbone collection ' + parent_collection_name + ' is not defined as a valid collection in config.domains.');
		}
		if (req.method == "POST") { //this should create a new model
			//created_at, collection_name, updated_at, owner, read_access, write_access, children
			// parameters are treated differently and are reserved words.
			//parameter "id" should not be passed but if it does, it'll be ignored.
			//parent_* fields will be used to update the parent (they'll be applied if the parent is passed)
			//parent_arrayappend_n_* will be used to update the parent - as an array with size n
			//retry = 1: says this is a retry. make sure we have not already saved this
			var is_retry = params.retry;
			if (isNaN(is_retry)) {
				is_retry = 0
			} else {
				is_retry = parseInt(is_retry);
			}
			delete params['retry'];
			var now = (new Date()).getTime();

			function create_object(parent) {
				if (params['child']) { //if the object is to be created along with its parent
					var child = JSON.parse(params['child']);
					delete params['child'];
				} else {
					var child = null;
				}
				if (params['parent']) { //
					var parent = JSON.parse(params['parent']);
					delete params['parent'];
					var child = params;
					params = parent;
				}
				var parent_fields = {}
				for (var i in params) {
					if (i.indexOf('parent_') == 0) {
						parent_fields[i.split('parent_')[1]] = params[i];
						delete params[i];
					}
				}
				params['owner'] = req.user._id;
				params['write_access'] = arrayify(params['write_access'] || self.config.permissions.default_write);
				params['read_access'] = arrayify(params['read_access'] || self.config.permissions.default_read);
				params['created_at'] = now;
				params['updated_at'] = now;
				params['collection_name'] = collection_name;
				delete params['id'];
				delete params['children'];
				if (child) {
					params['children'] = 1;
				}
				var id = uuid.v4();
				self.config.before_create({
					collection_name: collection_name,
					data: params,
					domain: domain,
					id: id,
					req: req,
					sdb: self.sdb
				}, function(data) {
					var process_put = function(err) {
							if (err) {
								if (done) {
									done(err, result);
								} else {
									res.json({
										type: 'error',
										msg: err.Message || 'bad query'
									});
								}
								return
							}
							if (child) {
								collection_name = collection_name + '/' + id;
								for (var i in self.config.domains) {
									if ((new RegExp(i)).test(collection_name)) {
										domain = self.config.domains[i];
										break
									}
								}
								params = child;
								create_object();
							} else {
								data['id'] = id;
								//delete params['collection_name'];
								self.config.after_create({
									collection_name: collection_name,
									data: data,
									domain: domain,
									id: id,
									req: req,
									sdb: self.sdb
								});
								delete data['write_access'];
								delete data['read_access'];
								delete data['child'];
								if (done) {
									done(null, data);
								} else {
									res.json(data);
								}
								//if the object is a child of another object, update the parent.
								//this is called after the function is returned (the user does not need to wait for this)
								if (parent) {
									var Data = {
										updated_at: (new Date()).getTime(),
										children: parent.children ? (parseInt(parent.children) + 1) : 1
									}
									var j = 0;
									var override = {
										'Expected.1.Name': 'updated_at',
										'Expected.1.Value': parent.updated_at
									}
									var num_of_attr = 2;
									for (var i in parent_fields) {
										num_of_attr = num_of_attr + 1;
										if (i.indexOf('arrayappend_') == 0) {
											try {
												var size = parseInt(i.split('arrayappend_')[1].split('_')[0]);
												var key = i.split('arrayappend_' + size + '_')[1];
												var value = parent_fields[i];
												if (parent[key]) {
													var cur = parent[key]=='0'? [] : JSON.parse(parent[key]);
													cur.push(value);
													(cur.length > size) && cur.splice(0, 1);
													Data[key] = JSON.stringify(cur);
												} else {
													Data[key] = JSON.stringify([value]);
												}
											} catch (e) {

											}
										} else {
											Data[i] = parent_fields[i];
										}
									}
									var update_with_lock = function() {
											j = j + 1;
											self.sdb.putItem(parent_domain, requested_id, Data, override, function(err) {
												if (err && (j < 5)) {
													var reread_the_item = function() {
															self.sdb.getItem(parent_domain, requested_id, function(err, result) {
																if (err) {
																	reread_the_item();
																	return
																}
																parent = result;
																update_with_lock();
															})
														}
													reread_the_item();
													return
												}
											});
										}
									update_with_lock();
								}
							}
						};
					//check if this item already exists (to prevent re-creating the same objects because of network issues)
					if (is_retry) {
						var check_rep_data = "";
						for (var i in data) {
							if ((i != 'created_at') && (i != 'updated_at') && (i != 'write_access') && (i != 'read_access') && (typeof(data[i]) == 'string')) {
								check_rep_data = check_rep_data + (check_rep_data == "" ? "" : " and ") + ("`" + i + "`='" + data[i] + "'");
							}
						}
						check_rep_data = check_rep_data + " and `created_at`>'" + (now - is_retry) + "'";
						var q = "select ItemName() from `" + domain + "` where " + check_rep_data;
						self.sdb.select(q, function(err, result) {
							if (err) {
								if (done) {
									done(err, result);
								} else {
									res.json({
										type: 'error',
										msg: err.Message || 'bad query'
									});
								}
								return
							}
							if (result && (result.length > 0)) { //you don't need to write it again
								id = result[0]['$ItemName']
								process_put()
							} else {
								self.sdb.putItem(domain, id, data, process_put)
							}
						});
						return
					}
					self.sdb.putItem(domain, id, data, process_put)
				})
			}
			if (parent_domain) { //if the object is to be created as a child of another object.
				can_update(parent_domain, requested_id, create_object)
			} else {
				create_object();
			}
		}
		if (req.method == "GET") { //this should return models (or model)
			if (params.id) { //the client is asking for only one model (not the whole collection)
				self.sdb.getItem(domain, params.id, function(error, result) {
					if (error) {
						res.json({
							type: 'error',
							msg: error.Message || 'bad query'
						})
						return
					}
					if (!result) {
						res.json({});
						return
					}
					//check if the user who is asking for it actually has permission to read this.
					if ((result.read_access == '*') || (result.owner == req.user._id) || (result.read_access.indexOf(req.user._id) != -1)) {
						result.id = result['$ItemName'];
						delete result['$ItemName'];
						delete result.read_access;
						delete result.collection_name;
						delete result.write_access;
						res.json(result);
						return
					} else {
						res.json({
							type: 'error',
							msg: 'permission denied.'
						})
					}
				})
			} else {
				//only getting the items that are in the requested domain/collection and the user has read-access to.
				var query = "select * from `" + domain + "` where `updated_at` is not null and collection_name='" + collection_name + "' and (read_access in ('*', '" + req.user._id + "') or owner='" + req.user._id + "')";
				var where = null;
				if (params.where) {
					try {
						var where = JSON.parse(params.where)
					} catch (e) {
						var where = null;
					}
				}
				if (where) {
					//query = query + ' and ';
					for (var i in where) {
						query = query + " and `" + i + "`" + where[i]
					}
				}
				query = query + ' order by `updated_at` DESC limit 20';
				self.sdb.select(query, function(error, result) {
					if (error) {
						res.json({
							type: 'error',
							msg: error.Message || 'bad query'
						})
						return
					}
					for (var i = 0; i < result.length; i++) {
						result[i].id = result[i]['$ItemName'];
						delete result[i]['$ItemName'];
						delete result[i].read_access;
						delete result[i].collection_name;
						delete result[i].write_access;
					}
					res.json(result)
				});
			}
		}
		if (req.method == "PUT") { //this should modify a specific model
			if (!params.id) {
				res.json({
					type: 'error',
					msg: 'the item does not have an id field.'
				});
				return
			}
			var parent = false;
			var now = (new Date()).getTime();
			var parent_fields = {}
			for (var i in params) {
				if (i.indexOf('parent_') == 0) {
					parent = true;
					parent_fields[i.split('parent_')[1]] = params[i];
					delete params[i];
				}
			}

			function update_object(Domain, Params, silence) {
				can_update(Domain, Params.id, function(result) {
					//check if the user who is asking for it actually has permission to read this.
					var id = result['$ItemName'];
					if (parent) {
						parent = false;
						parent_fields.id = result['collection_name'].split(parent_collection_name + '/')[1];
						update_object(parent_domain, parent_fields, true);
					}
					var updated_at = Params['updated_at'];
					delete result['$ItemName'];
					result['updated_at'] = now;
					delete Params['owner'];
					delete Params['id'];
					delete Params['children'];
					delete Params['updated_at'];
					delete Params['created_at'];
					delete Params['collection_name'];
					for (var i in Params) {
						result[i] = Params[i];
					}
					result['write_access'] = arrayify(result['write_access']);
					result['read_access'] = arrayify(result['read_access']);
					for (var i in Params) {
						if (i.indexOf('arrayremove_') == 0) {
							try {
								var key = i.split('arrayremove_')[1];
								var item = Params[i];
								if (result[key]) {
									var cur = parent[key]=='0'? [] : JSON.parse(parent[key]);
									var index = cur.indexOf(item);
									if (index != -1) {
										cur.splice(index, 1);
										if (cur.length){
											result[key] = JSON.stringify(cur);
										}else{
											result[key] = '0';
										}
									}
								}
								delete result[i];
								} catch (e) {

								}
							}
						}
						var j = 0;
						var update_with_lock = function() {
								j = j + 1;
								self.sdb.putItem(Domain, id, result, {
									'Expected.1.Name': 'updated_at',
									'Expected.1.Value': updated_at
								}, function(err) {
									if ((err) && (err.Code == 'ConditionalCheckFailed') && (j < 5)) {
										updated_at = err.Message.split('value is (')[1].split(')')[0];
										result['updated_at'] = (new Date()).getTime();
										update_with_lock();
										return
									}
									if (err) {
										(!silence) && res.json({
											type: 'error',
											msg: err.Message || 'bad query'
										});
										return
									}
									result['id'] = id;
									delete result.read_access;
									delete result.collection_name;
									delete result.write_access;
									(!silence) && res.json(result);
								});
							}
						update_with_lock();
					});
				}
				update_object(domain, params);
			}
			if (req.method == "DELETE") { //this should delete a specific model - id is passed through url
				if (!params.id) {
					res.json({
						type: 'error',
						msg: 'what id should be deleted?'
					});
					return
				}
				can_update(domain, params.id, function(result) {
					self.sdb.deleteItem(domain, params.id, function(err) {
						if (err) {
							res.json({
								type: 'error',
								msg: err.Message || 'bad query'
							});
							return
						}
						res.json({});
					});
				})
			}
		}
		return this
	}
