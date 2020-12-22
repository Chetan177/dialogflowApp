const fs = require('fs');
const uuid = require('uuid');
const request = require('request')
const { struct } = require('pb-util');
const dialogflow = require('@google-cloud/dialogflow');
const WebSocket = require('ws');
const argv = require('minimist')(process.argv.slice(2));
const util = require('util');
var FileWriter = require('wav').FileWriter;
let calluuid = ""

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
let sessionID = uuid.v4();
function getDialogflowStream() {
    let sessionClient = new dialogflow.SessionsClient();

    let sessionPath = sessionClient.projectAgentSessionPath(
        projectId,
        sessionID,
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
        .on('error', error => {
            console.error(error);
            writeFlag = false;
            detectStream.end();
        })
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
                    // Call Modify API 
                    getModifyCall(audioFile)
                }

            }
        });

    // Write the initial stream request to config for audio input.
    detectStream.write(initialStreamRequest);

    return detectStream;

}

async function getModifyCall(filePath) {
    /*
    modify API request
    /v1.0/accounts/{accID}/calls/{uuid}/modify
    {
      "cccml": "<Response id='ID2'><Play loop='1'>https://www2.cs.uic.edu/~i101/SoundFiles/CantinaBand3.wav</Play></Response>",
    }
    */
    let data = {
        "cccml": "<Response id='Id2'><Play loop='1'>file_string://" + filePath + "!silence_stream://15000</Play></Response>",
    }
    request.post(
        'http://localhost:8888/v1.0/accounts/123/calls/CID__' + calluuid + '/modify',
        {
            json: data
        },
        (error, res, body) => {
            if (error) {
                console.error(error)
                return
            }
            console.log(`statusCode: ${res.statusCode}`)
            console.log(body)
        }
    )
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
            //uuid-8660df10-0bf3-4813-adae-97baa45c9d03
            calluuid =JSON.parse(message).uuid;
            console.log(`UUID: ${calluuid}`);
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
        sessionID = uuid.v4();
    });
    
});

// ToDo Further handling of Modify and flow
