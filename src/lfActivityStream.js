'use strict';
const util = require('util');
const jwt = require('jwt-simple');
const request = require('request');
const livefyre = require('livefyre');
const _ = require('lodash');
const config = require('./config');

class lfActivityStreamClient {
	constructor(lfNetwork, lfNetworkSecret) {

		if (!lfNetwork) {
			throw new Error('No network provided!');
		}
		if (!lfNetworkSecret) {
			throw new Error('No network secret provided!');
		}

		this.config = config;
		this.options = {
			type: 0,
			interval: 10
		};
		this.authToken = null;
		this.lfNetwork = lfNetwork;
		this.lfNetworkSecret = lfNetworkSecret;
		this.network = livefyre.getNetwork(this.lfNetwork, this.lfNetworkSecret);
		this.networkUrn = this.network.getUrn();
	}
	url() {
		return [
			this.config.protocol,
			util.format(this.config.endpoint, this.network.getNetworkName())
		].join('');
	}
	setOptions(opts) {
		this.options = _.defaults(opts, this.options);
		return this;
	}
	token(expires) {

		if (!expires || new Date().getTime() >= expires) {
			expires = new Date(new Date().getTime() + 60 * 60 * 1000).getTime();
		}

		let authData = {
			iss: this.networkUrn,
			aud: this.networkUrn,
			sub: this.networkUrn,
			scope: this.config.authScope,
			exp: expires
		};

		this.authToken = jwt.encode(authData, this.lfNetworkSecret);
		return this.authToken;
	}
	requestOptions(eventId) {
		return {
			url: this.url(),
			qs: {resource: this.networkUrn, since: eventId},
			method: 'GET',
			headers: {
				'Authorization': 'Bearer ' + this.token()
			}
		};
	}
	getAuthor(authorId, authors) {
		if (authorId && authors.hasOwnProperty(authorId)) {
			return {
				displayName: authors[authorId].displayName,
				tags: authors[authorId].tags,
				type: authors[authorId].type,
				id: authors[authorId].id
			};
		}
		return null;
	}
	getArticle(collectionId, collections) {
		if (collectionId && collections.hasOwnProperty(collectionId)) {
			return {
				url: collections[collectionId].url,
				articleId: collections[collectionId].articleIdentifier,
				siteId: collections[collectionId].site,
				title: collections[collectionId].title
			};
		}
		return null;
	}
	makeRequest(eventId, cb, once) {
		if ( cb && typeof cb == 'function') {
			const requestOptions = this.requestOptions(eventId);

			console.log(requestOptions.method || 'REQUEST', requestOptions.url);

			return request(requestOptions, (error, response, body) => {
				let nextEventId = null;

				if (error || response.statusCode !== 200) {
					cb(error || body, response);
				} else {
					var res;
					try {
						res = JSON.parse(body);
					} catch (e) {
						body = body.replace(/\\U/g, '\\\\u');
						res = JSON.parse(body);
					}

					if (res.hasOwnProperty('data') && res.data.hasOwnProperty('states')) {
						let data = [];

						if (res.hasOwnProperty('meta') && res.meta.hasOwnProperty('cursor')) {
							nextEventId = res.meta.cursor.next;
						}
						_.map(res.data.states, item => {
							if (item.type === this.options.type && item.event > eventId) {
								let dataItem = {
									collectionId: item.collectionId,
									article: this.getArticle(item.collectionId, res.data.collections),
									comment: {
										parentId: item.content.parentId || null,
										author: this.getAuthor(item.content.authorId, res.data.authors),
										content: item.content.bodyHtml || null,
										createdAt: item.content.createdAt || null,
										updatedAt: item.content.updatedAt || null,
										commentId: item.content.id || null,
										visibility: item.vis
									}
								};
								data.push(dataItem);
							}
						});

						if (once) {
							return cb(null, data, eventId);
						}

						if(data.length) {
							cb(null, data, eventId);
						}

						if (nextEventId !== null) {
							return this.makeRequest(nextEventId, cb);
						}
					}
				}
				/**
				 * if it got so far the call must be repeated because nextEventId is null
				 * (either there was an error or meta.cursor.next is null)
				 */
				if ( nextEventId === null ) {
					nextEventId = eventId;
					setTimeout(() => {
						this.makeRequest(nextEventId, cb);
					}, this.options.interval * 1000);
				}
			});
		}
	}
}

module.exports = lfActivityStreamClient;
