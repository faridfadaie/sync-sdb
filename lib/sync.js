var sdb = require('simpledb');
var uuid = require('node-uuid');

module.exports = function(config){
	this.config = config;
	this.config.permissions = this.config.permissions || {
		default_write : 'null',
		default_read : '*'
	}
	this.sdb = this.config.db || new sdb.SimpleDB({
	                                keyid: config.keyid,
	                                secret: config.secret
	                        });
	self = this;
	this.sync = function(req, res){
		if (req.route.path.indexOf('*') != req.route.path.length - 1){
			throw new Error('sdb-bb requires a dedicated path that is defined by something/*');
		}
		var path = req.originalUrl.split(req.route.path.split('*')[0])[1];
		var collection_name = path.split('/')[0];
		var domain = null;
		for (var i in self.config.domains){
			if ((new RegExp(i)).test(collection_name)){
				var domain = self.config.domains[i];
				break
			}
		}
		if (!domain){
			throw new Error('the backbone collection ' + collection_name + ' is not defined as a valid collection in config.domains.');
		}
		var params = req.body || req.query || {};
		if (req.method == "POST"){//this should create a new model
			//created_at, domain, updated_at, owner, read_access, write_access parameters are treated differently and are reserved words.
			//parameter "id" should not be passed but if it does, it'll be ignored.
			delete params['updated_at'];
			params['owner'] = req.user._id;
			params['write_access'] = (params['write_access'] || self.config.permissions.default_write).split(',');
			params['read_access'] = (params['read_access'] || self.config.permissions.default_read).split(',');
			params['created_at'] = (new Date()).getTime();
			params['domain'] = domain;
			delete params['id'];
			var id = uuid.v4();
			self.sdb.putItem(domain, id, params, function(err){
				if (err){
					res.json({type : 'error', msg : 'bad query'});
					return
				}
				params['id'] = id;
				res.json(params);
			});
		}
		var rest_of_url = req.originalUrl.split(collection_name)[1];
		var requested_id = rest_of_url.substr(0,1) == '/'? rest_of_url.split('/')[1] : null;
		if (requested_id && !(new RegExp('^([abcdef]|[0-9]){8}-([abcdef]|[0-9]){4}-([abcdef]|[0-9]){4}-([abcdef]|[0-9]){4}-([abcdef]|[0-9]){12}$')).test(requested_id)){
			res.json({type : 'error', msg : 'the id is not valid.'});
			return
		}
		if (req.method == "GET"){//this should return models (or model)
			if (requested_id){//the client is asking for only one model (not the whole collection)
				self.sdb.getItem(domain, requested_id, function(error, result){
					if (error){
						res.json({type : 'error', msg : 'bad query'})
						return
					}
					if (!result){
						res.json({});
						return
					}
					//check if the user who is asking for it actually has permission to read this.
					if ((result.read_access == '*') || (result.owner == req.user._id) || (result.read_access.indexOf(req.user._id) != -1)){
						result.id = result['$ItemName'];
						delete result['$ItemName'];
						delete result.read_access;
						delete result.domain;
						delete result.write_access;
						res.json(result);
						return
					}else{
						res.json({type : 'error', msg : 'permission denied.'})
					}
				})
			}else{
				//only getting the items that are in the requested domain/collection and the user has read-access to.
				var query = "select * from "+domain+" where domain='" + domain + "' and (read_access in ('*', '"+req.user._id+"') or owner='"+req.user._id+"')";
				self.sdb.select(query, function(error, result){
					if (error){
						res.json({type : 'error', msg : 'bad query'})
						return
					}
					for (var i=0; i<result.length;i++){
						result[i].id = result['$ItemName'];
						delete result[i]['$ItemName'];
						delete result[i].read_access;
						delete result[i].domain;
						delete result[i].write_access;
					}					
					res.json(result)
				});
			}
		}
		if (req.method == "PUT"){//this should modify a specific model
			if (!params.id){
				res.json({type : 'error', msg : 'the item does not have an id field.'});
				return
			}
			self.sdb.getItem(domain, params.id, function(error, result){
				if (error){
					res.json({type : 'error', msg : 'bad query'})
					return
				}
				if (!result){
					res.json({type : 'error', msg : 'requested item does not exist.'})
					return
				}
				//check if the user who is asking for it actually has permission to read this.
				if ((result.write_access == '*') || (result.owner == req.user._id) || (result.write_access.indexOf(req.user._id) != -1)){
					var id = result['$ItemName'];
					delete result['$ItemName'];
					result['updated_at'] = (new Date()).getTime();
					delete params['owner'];
					delete params['id'];
					delete params['updated_at'];
					delete params['created_at'];
					delete params['domain'];
					for (var i in params){
						result[i] = params[i];
					}
					self.sdb.putItem(domain, id, result, function(err){
						if (err){
							res.json({type : 'error', msg : 'bad query'});
							return
						}
						result['id'] = id;
						delete result.read_access;
						delete result.domain;
						delete result.write_access;
						res.json(result);
					});
				}else{
					res.json({type : 'error', msg : 'permission denied.'})
				}
			})
		}		
		if (req.method == "DELETE"){//this should delete a specific model - id is passed through url
			if (!requested_id){
				res.json({type : 'error', msg : 'what id should be deleted?'});
				return
			}
			self.sdb.getItem(domain, requested_id, function(error, result){
				if (error){
					res.json({type : 'error', msg : 'bad query'})
					return
				}
				if (!result){
					res.json({type : 'error', msg : 'requested item does not exist.'})
					return
				}
				//check if the user who is asking for it actually has permission to read this.
				if ((result.write_access == '*') || (result.owner == req.user._id) || (result.write_access.indexOf(req.user._id) != -1)){
					self.sdb.deleteItem(domain, requested_id, function(err){
						if (err){
							res.json({type : 'error', msg : 'bad query'});
							return
						}
						res.json({});
					});
				}else{
					res.json({type : 'error', msg : 'permission denied.'})
				}
			})
			
		}		
	}
	return this
}