const fs = require('fs');
const uuid = require('uuid');
const { struct } = require('pb-util');
const dialogflow = require('@google-cloud/dialogflow');
const WebSocket = require('ws');
const argv = require('minimist')(process.argv.slice(2));


const port = argv.port && parseInt(argv.port) ? parseInt(argv.port) : 3001

const credLocation = process.env.GOOGLE_APPLICATION_CREDENTIALS;
let rawdata = fs.readFileSync(credLocation);
let googleCred = JSON.parse(rawdata);

console.log(`GoogleCred location; ${credLocation}`);

const projectId = googleCred.project_id;
const encoding = 'AUDIO_ENCODING_LINEAR_16';
const sampleRateHertz = 16000;
const languageCode = 'en-US';

// Create a stream for the streaming request.
function getDialogflowStream() {
    let sessionClient = new dialogflow.SessionsClient();

    let sessionPath = sessionClient.projectAgentSessionPath(
        projectId,
        uuid.v4(),
    );

    // First Request 
    let initialStreamRequest = {
        session: sessionPath,
        queryInput: {
            audioConfig: {
                audioEncoding: encoding,
                sampleRateHertz: sampleRateHertz,
                languageCode: languageCode,
            },
            singleUtterance: true,
        },
    };

    const detectStream = sessionClient
        .streamingDetectIntent()
        .on('error', console.error)
        .on('data', data => {
            if (data.recognitionResult) {
                console.log(
                    `Intermediate transcript: ${data.recognitionResult.transcript}`
                );
            } else {
                console.log('Detected intent:');

                const result = data.queryResult;
                // Instantiates a context client
                const contextClient = new dialogflow.ContextsClient();

                console.log(`  Query: ${result.queryText}`);
                console.log(`  Response: ${result.fulfillmentText}`);
                if (result.intent) {
                    console.log(`  Intent: ${result.intent.displayName}`);
                } else {
                    console.log('  No intent matched.');
                }
                const parameters = JSON.stringify(struct.decode(result.parameters));
                console.log(`  Parameters: ${parameters}`);
                if (result.outputContexts && result.outputContexts.length) {
                    console.log('  Output contexts:');
                    result.outputContexts.forEach(context => {
                        const contextId = contextClient.matchContextFromProjectAgentSessionContextName(
                            context.name
                        );
                        const contextParameters = JSON.stringify(
                            struct.decode(context.parameters)
                        );
                        console.log(`    ${contextId}`);
                        console.log(`      lifespan: ${context.lifespanCount}`);
                        console.log(`      parameters: ${contextParameters}`);
                    });
                }
            }
        });

        // Write the initial stream request to config for audio input.
        detectStream.write(initialStreamRequest);

        return detectStream;

}



console.log(`listening on port ${port}`);

const wss = new WebSocket.Server({
    port,
    handleProtocols: (protocols, req) => {
        return 'audio.drachtio.org';
    }
});

wss.on('connection', (ws, req) => {
    console.log(`received connection from ${req.connection.remoteAddress}`);
    const dialogflowStreamer = getDialogflowStream();

    ws.on('message', (message) => {
        if (typeof message === 'string') {
            console.log(`received message: ${message}`);
        } else if (message instanceof Buffer) {
            // Transform message and write to detect
            dialogflowStreamer.write({inputAudio: message});
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`socket closed ${code}:${reason}`);
        dialogflowStreamer.end();
    });
});

// ToDo Further handling of Modify and flow
