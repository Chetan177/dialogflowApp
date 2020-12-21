const fs = require('fs');
const uuid = require('uuid');
const { struct } = require('pb-util');
const dialogflow = require('@google-cloud/dialogflow');
const WebSocket = require('ws');
const argv = require('minimist')(process.argv.slice(2));
const util = require('util');
var FileWriter = require('wav').FileWriter;


const port = argv.port && parseInt(argv.port) ? parseInt(argv.port) : 3001
const audioPath = "/tmp/"

const credLocation = process.env.GOOGLE_APPLICATION_CREDENTIALS;
let rawdata = fs.readFileSync(credLocation);
let googleCred = JSON.parse(rawdata);

console.log(`GoogleCred location; ${credLocation}`);

const projectId = googleCred.project_id;
const encoding = 'AUDIO_ENCODING_LINEAR_16';
const sampleRateHertz = 16000;
const languageCode = 'en-US';

let writeFlag = true;

function writeAudioToFile(audioBuffer) {
    let filePath = audioPath + uuid.v4() + '.wav'
    let outputFileStream = new FileWriter(filePath, {
        sampleRate: 24000,
        channels: 1
    });
    outputFileStream.write(audioBuffer);
    return filePath;
}

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
                if (data.recognitionResult.isFinal == true) {
                    writeFlag = false;
                    detectStream.end();
                }
            } else {
                console.log('----------------------------------------------');
                console.log(util.inspect(data, { showHidden: false, depth: null }));

                if (data.responseId == '' && data.recognitionResult == null && data.queryResult == null) {
                   let audioFile = writeAudioToFile(data.outputAudio);
                   console.log(`audio file location: ${audioFile}`); 

                }

                // ToDo Call async modify api with play audio and 30 sec pause.
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
    let dialogflowStreamer = getDialogflowStream();

    ws.on('message', (message) => {
        if (typeof message === 'string') {
            console.log(`received message: ${message}`);
            
            // ToDo save uuid for modify call
        } else if (message instanceof Buffer) {
            // Transform message and write to detect
            if (writeFlag) {
                dialogflowStreamer.write({ inputAudio: message });
            } else {
                dialogflowStreamer = getDialogflowStream();
                dialogflowStreamer.write({ inputAudio: message });
                writeFlag = true;
            }

        }
    });

    ws.on('close', (code, reason) => {
        console.log(`socket closed ${code}:${reason}`);
        dialogflowStreamer.end();
    });
});

// ToDo Further handling of Modify and flow
