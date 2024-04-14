const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable-serverless');
const speech = require('@google-cloud/speech');
const tmp = require('tmp');
// comment out the following line for local development
ffmpeg.setFfmpegPath(path.join(__dirname, '../bin/ffmpeg'));

tmp.setGracefulCleanup(); // Delete temporary files and directories on cleanup

console.log('All modules imported successfully');

// Map the audio codec to the corresponding encoding
const codecToEncoding = {
    pcm_s16le: 'LINEAR16',
    flac: 'FLAC',
    // Add more mappings as needed
};

module.exports = async (req, res) => {
    console.log('Inside module.exports');
    const form = new formidable.IncomingForm();
    
    form.parse(req, async (err, fields, files) => {
        console.log('Inside form.parse');
        if (err) {
            res.status(500).json({ error: 'Could not parse the upload file.' });
            return;
        }
        
        const file = files.audio.path;
        const originalFilename = files.audio.name;
        const extension = path.extname(originalFilename);
        const client = new speech.SpeechClient({
            credentials: JSON.parse(Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('ascii'))
        });
        
        console.log(`Processing file: ${originalFilename}`);
        
        // Get the duration of the audio file
        const duration = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(file, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata.format.duration);
            });
        });
        
        console.log(`File duration: ${duration} seconds`);
        
        // Get the audio properties of the file
        const audioProperties = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(file, (err, metadata) => {
                if (err) reject(err);
                else {
                    const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
                    resolve({
                        codec: audioStream.codec_name,
                        sampleRate: audioStream.sample_rate,
                        channels: audioStream.channels,
                    });
                }
            });
        });
        
        console.log(`Audio properties: ${JSON.stringify(audioProperties)}`);
        
        // Calculate the number of chunks
        const chunkDuration = 59; // 1 minute
        const numChunks = Math.ceil(duration / chunkDuration);
        
        console.log(`Splitting file into ${numChunks} chunks`);
        
        // Extract each chunk
        let transcriptions = []; // Declare transcriptions array here
        for (let i = 0; i < numChunks; i++) {
            const tempDir = tmp.dirSync({ unsafeCleanup: true }).name;
            console.log(`Creating temporary directory: ${tempDir}`);
            const output = path.join(tempDir, `out${i}${extension}`);
            try {
                await new Promise((resolve, reject) => {
                    ffmpeg(file)
                    .seekInput(i * chunkDuration)
                    .duration(chunkDuration)
                    .output(output)
                    .on('end', async () => { // Add async here
                        console.log('After setting up ffmpeg command');
                        
                        // Read the chunks
                        const chunks = fs.readdirSync(tempDir);
                        
                        // Process each chunk
                        for (const chunk of chunks) {
                            const chunkPath = path.join(tempDir, chunk);
                            const audioBytes = fs.readFileSync(chunkPath).toString('base64');
                            const audio = { content: audioBytes };
                            const config = { 
                                encoding: codecToEncoding[audioProperties.codec],
                                sampleRateHertz: audioProperties.sampleRate,
                                audioChannelCount: audioProperties.channels,
                                languageCode: 'kn-IN',
                            };
                            const request = { audio: audio, config: config };
                            
                            console.log(`Sending chunk ${i + 1} of ${numChunks} to Google Speech-to-Text API. Request: `, request.config);
                            
                            try {
                                const [response] = await client.recognize(request);
                                const transcription = response.results.map(result => result.alternatives[0].transcript).join('\n');
                                transcriptions.push(transcription);
                                console.log(`Received transcription for chunk ${i + 1} of ${numChunks}`);
                            } catch (error) {
                                console.error(`Error transcribing chunk ${i + 1} of ${numChunks}:`, error);
                                res.status(500).send('Error transcribing audio');
                            }
                        }
                        
                        resolve();
                    })
                    .on('error', reject)
                    .run();
                });
            } catch (error) {
                console.error(`Error processing chunk ${i + 1} of ${numChunks}:`, error);
                res.status(500).send('Error processing audio');
                return;
            }
        }
        console.log('Sending complete transcription back to client');
        res.status(200).send({ transcription: transcriptions.join('\n') });
        
    });
};