Facebook = {};

var querystring = Npm.require('querystring');

Facebook.handleAuthFromAccessToken = function handleAuthFromAccessToken(accessToken, expiresAt) {
  // include all fields from facebook
  // http://developers.facebook.com/docs/reference/login/public-profile-and-friend-list/
  var whitelisted = ['id', 'email', 'name', 'first_name',
      'last_name', 'link', 'gender', 'locale', 'age_range'];

  var identity = getIdentity(accessToken, whitelisted);

  var serviceData = {
    accessToken: accessToken,
    expiresAt: expiresAt
  };

  var fields = _.pick(identity, whitelisted);
  _.extend(serviceData, fields);

  return {
    serviceData: serviceData,
    options: {profile: {name: identity.name}}
  };
};

OAuth.registerService('facebook', 2, null, function(query) {
  var response = getTokenResponse(query);
  var accessToken = response.accessToken;
  var expiresIn = response.expiresIn;

  return Facebook.handleAuthFromAccessToken(accessToken, (+new Date) + (1000 * expiresIn));
});

// checks whether a string parses as JSON
var isJSON = function (str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
};

// returns an object containing:
// - accessToken
// - expiresIn: lifetime of token in seconds
var getTokenResponse = function (query) {
  var config = ServiceConfiguration.configurations.findOne({service: 'facebook'});
  if (!config)
    throw new ServiceConfiguration.ConfigError();

  var responseContent;
  try {
    // Request an access token
    responseContent = HTTP.get(
      "https://graph.facebook.com/v2.2/oauth/access_token", {
        params: {
          client_id: config.appId,
          redirect_uri: OAuth._redirectUri('facebook', config),
          client_secret: OAuth.openSecret(config.secret),
          code: query.code
        }
      }).content;
  } catch (err) {
    throw _.extend(new Error("Failed to complete OAuth handshake with Facebook. " + err.message),
                   {response: err.response});
  }

  // If 'responseContent' parses as JSON, it is an error.
  // XXX which facebook error causes this behvaior?
  if (isJSON(responseContent)) {
    throw new Error("Failed to complete OAuth handshake with Facebook. " + responseContent);
  }

  // Success!  Extract the facebook access token and expiration
  // time from the response
  var parsedResponse = querystring.parse(responseContent);
  var fbAccessToken = parsedResponse.access_token;
  var fbExpires = parsedResponse.expires;

  if (!fbAccessToken) {
    throw new Error("Failed to complete OAuth handshake with facebook " +
                    "-- can't find access token in HTTP response. " + responseContent);
  }
  return {
    accessToken: fbAccessToken,
    expiresIn: fbExpires
  };
};

var getIdentity = function (accessToken, fields) {
  try {
    return HTTP.get("https://graph.facebook.com/v2.4/me", {
      params: {
        access_token: accessToken,
        fields: fields
      }
    }).data;
  } catch (err) {
    throw _.extend(new Error("Failed to fetch identity from Facebook. " + err.message),
                   {response: err.response});
  }
};

Facebook.retrieveCredential = function(credentialToken, credentialSecret) {
  return OAuth.retrieveCredential(credentialToken, credentialSecret);
};

/*
 * Get the access token to identify our app with facebook
 * (it should only run once since we cache the result and there don't seem to be an expiration on the token)
 */
let appAccessToken = null;
const getAppAccessToken = () => {
  if (!appAccessToken) {
    const config = ServiceConfiguration.configurations.findOne({ service: 'facebook' });
    const response = HTTP.get(
      'https://graph.facebook.com/oauth/access_token', {
        params: {
          client_id: config.appId,
          client_secret: OAuth.openSecret(config.secret),
          grant_type: 'client_credentials',
        },
      }).content;
    appAccessToken = response.replace('access_token=', '');
  }
  return appAccessToken;
};

/*
 * Returns the expiration (unix time in ms) of the given token
 * If the token is not valid, this function will fail
 */
Facebook.getTokenExpiration = (fbAccessToken) => {
  let expiresAt;
  try {
    expiresAt = JSON.parse(HTTP.get('https://graph.facebook.com/debug_token', {
      params: {
        input_token: fbAccessToken,
        access_token: getAppAccessToken(),
      },
    }).content).data.expires_at * 1000;
  } catch (e) {
    if (e.response) {
      const errorType = JSON.parse(e.response.content).error.type;
      if (errorType === 'OAuthException') {
        throw new Error('Facebook access token is not valid');
      }
    } else {
      throw(e); 
    }
  }
  return expiresAt;
};
