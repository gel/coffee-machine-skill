/*
 * Copyright 2018-2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

//
// Alexa Fact Skill - Sample for Beginners
//

// sets up dependencies
const AWS = require('aws-sdk');
AWS.config.update({region: process.env.DYNAMODB_PERSISTENCE_REGION});

const Alexa = require('ask-sdk-core');
const i18n = require('i18next');
const sprintf = require('i18next-sprintf-postprocessor');

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const TableName = process.env.DYNAMODB_PERSISTENCE_TABLE_NAME;

// helper functions for supported interfaces
function supportsInterface(handlerInput, interfaceName) {
  const interfaces = ((((
    handlerInput.requestEnvelope.context || {})
    .System || {})
    .device || {})
    .supportedInterfaces || {});
  return interfaces[interfaceName] !== null && interfaces[interfaceName] !== undefined;
}
function supportsAPL(handlerInput) {
  return supportsInterface(handlerInput, 'Alexa.Presentation.APL')
}

async function getCountFromDynamoDB(id) {
  const params = {
    TableName: TableName,
    Key: { id: id },
  };
  const data = await dynamoDB.get(params).promise();
  return data.Item ? data.Item.count : 0;
}

async function incrementCountInDynamoDB(id) {
  const params = {
    TableName: TableName,
    Key: { id: id },
    UpdateExpression: 'SET #c = #c + :increment',
    ExpressionAttributeNames: { '#c': 'count' },
    ExpressionAttributeValues: { ':increment': 1 },
    ReturnValues: 'UPDATED_NEW'
  };

  try {
    const data = await dynamoDB.update(params).promise();
    const updatedCount = data.Attributes.count;
    return updatedCount;
  } catch (error) {
    if (error.code === 'ValidationException' && error.message.includes('The provided expression refers to an attribute that does not exist in the item')) {
      // Item doesn't exist, attempt to create a new item
      return createCountInDynamoDB(userId);
    } else {
      console.error(`Error updating count: ${error.message}`);
      throw error;
    }
  }
}

async function createCountInDynamoDB(userId) {
  const params = {
    TableName: TableName,
    Item: { userId: userId, count: 1 },
    ConditionExpression: 'attribute_not_exists(userId)'
  };

  try {
    await dynamoDB.put(params).promise();
    return 1;
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      // Another concurrent write created the item, retry incrementing the count
      return incrementCountInDynamoDB(userId);
    } else {
      console.error(`Error creating count: ${error.message}`);
      throw error;
    }
  }
}

async function performMaintenance(id, count) {
  const params = {
    TableName: TableName,
    Key: { id: id },
    UpdateExpression: 'SET #lm = :count',
    ExpressionAttributeNames: { '#lm': 'lastMaintenance' },
    ExpressionAttributeValues: { ':count': count },
  };

  try {
    await dynamoDB.update(params).promise();
  } catch (error) {
    console.error(`Error marking last maintenance: ${error.message}`);
    throw error;
  }
}

// core functionality for fact skill
const MakeCoffeeHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return request.type === 'LaunchRequest'
      || (request.type === 'IntentRequest' && request.intent.name === 'MakeCoffeeIntent')
      || (request.type === 'IntentRequest' && request.intent.name === 'CountCoffeeIntent')
      || (request.type === 'IntentRequest' && request.intent.name === 'PerformMaintenanceIntent');
  },
  async handle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const userId = handlerInput.requestEnvelope.session.user.userId;    
    if (request.type === 'IntentRequest' && request.intent.name === 'MakeCoffeeIntent') {
        try {
          const count = await incrementCountInDynamoDB(userId);
          const speechText = `Tally recorded. Your count is now ${count}.`;
          return handlerInput.responseBuilder
            .speak(speechText)
            .getResponse();
        } catch (error) {
          console.error(`Error handled: ${error.message}`);
          const speechText = 'Sorry, I couldn\'t record your tally. Please try again.';
          return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .getResponse();
        } 
    } else if (request.type === 'IntentRequest' && request.intent.name === 'CountCoffeeIntent') {
      const count = await getCountFromDynamoDB(userId);
      const speechText = `You have made ${count} coffees.`;
      return handlerInput.responseBuilder
        .speak(speechText)
        .getResponse();
    } else if (request.type === 'IntentRequest' && request.intent.name === 'PerformMaintenanceIntent') {
      const count = await getCountFromDynamoDB(userId);
      await performMaintenance(userId, count);
      const speechText = `You have cleaned the machine on coffee number ${count}.`;
      return handlerInput.responseBuilder
        .speak(speechText)
        .getResponse();        
    } else {
      const speechText = 'Welcome to coffee machine skill. You can say make coffee, perform maintenance or count coffee';
      return handlerInput.responseBuilder
        .speak(speechText)
        .reprompt(speechText)
        .getResponse();
    }
  },
};

const HelpHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return request.type === 'IntentRequest'
      && request.intent.name === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    return handlerInput.responseBuilder
      .speak(requestAttributes.t('HELP_MESSAGE'))
      .reprompt(requestAttributes.t('HELP_REPROMPT'))
      .getResponse();
  },
};

const FallbackHandler = {
  // The FallbackIntent can only be sent in those locales which support it,
  // so this handler will always be skipped in locales where it is not supported.
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return request.type === 'IntentRequest'
      && request.intent.name === 'AMAZON.FallbackIntent';
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    return handlerInput.responseBuilder
      .speak(requestAttributes.t('FALLBACK_MESSAGE'))
      .reprompt(requestAttributes.t('FALLBACK_REPROMPT'))
      .getResponse();
  },
};

const ExitHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return request.type === 'IntentRequest'
      && (request.intent.name === 'AMAZON.CancelIntent'
        || request.intent.name === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    return handlerInput.responseBuilder
      .speak(requestAttributes.t('STOP_MESSAGE'))
      .getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`);
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error handled: ${error.message}`);
    console.log(`Error stack: ${error.stack}`);
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    return handlerInput.responseBuilder
      .speak(requestAttributes.t('ERROR_MESSAGE'))
      .reprompt(requestAttributes.t('ERROR_MESSAGE'))
      .getResponse();
  },
};

const LocalizationInterceptor = {
  process(handlerInput) {
    // Gets the locale from the request and initializes i18next.
    const localizationClient = i18n.use(sprintf).init({
      lng: handlerInput.requestEnvelope.request.locale,
      resources: languageStrings,
      returnObjects: true
    });
    // Creates a localize function to support arguments.
    localizationClient.localize = function localize() {
      // gets arguments through and passes them to
      // i18next using sprintf to replace string placeholders
      // with arguments.
      const args = arguments;
      let values = [];

      for (var i = 1; i < args.length; i++) {
        values.push(args[i]);
      }
      const value = i18n.t(args[0], {
        returnObjects: true,
        postProcess: 'sprintf',
        sprintf: values
      });
      // If an array is used then a random value is selected
      if (Array.isArray(value)) {
        let randomValue = Math.floor(Math.random() * value.length)
        return {
          "fact": value[randomValue],
          "url": planetURLs[randomValue]
        }
      }
      return value;
    };
    // this gets the request attributes and save the localize function inside
    // it to be used in a handler by calling requestAttributes.t(STRING_ID, [args...])
    const attributes = handlerInput.attributesManager.getRequestAttributes();
    attributes.t = function translate(...args) {
      return localizationClient.localize(...args);
    }
  }
};

const skillBuilder = Alexa.SkillBuilders.custom();

exports.handler = skillBuilder
  .addRequestHandlers(
    MakeCoffeeHandler,
    HelpHandler,
    ExitHandler,
    FallbackHandler,
    SessionEndedRequestHandler,
  )
  .addRequestInterceptors(LocalizationInterceptor)
  .addErrorHandlers(ErrorHandler)
  .withCustomUserAgent('sample/basic-fact/v2')
  .lambda();

const enData = {
  translation: {
    SKILL_NAME: '%s Facts',
    HELP_MESSAGE: 'You can say make coffee, say perform maintenance or say count coffees',
    HELP_REPROMPT: 'What can I help you with?',
    FALLBACK_MESSAGE: 'The Facts skill can\'t help you with that.  It can help you discover facts if you say tell me a fact. What can I help you with?',
    FALLBACK_REPROMPT: 'What can I help you with?',
    ERROR_MESSAGE: 'Sorry, an error occurred.',
  }
};

// constructs i18n and l10n data structure
const languageStrings = {
  'en': enData,
};
