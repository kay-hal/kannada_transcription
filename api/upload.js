const speech = require('@google-cloud/speech');
const {Storage} = require('@google-cloud/storage');
const fs = require('fs');
const formidable = require('formidable-serverless');
const mm = require('music-metadata');

const bucketName = 'kannada-transcription-bucket';
const path = require('path');

async function uploadFileToGCS(storage, filepath, extension) {
  const filename = path.basename(filepath);
  const destination = `${filename}${extension}`;
  await storage.bucket(bucketName).upload(filepath, {
    destination: destination,
    metadata: {
      cacheControl: 'public, max-age=31536000',
    },
  });
  console.log(`File ${destination} uploaded to ${bucketName}.`);
  return `gs://${bucketName}/${destination}`;
}

module.exports = async (req, res) => {
  const form = new formidable.IncomingForm();
  const maxInlineDuration = 6; 

  console.log('Inside module.exports');
  const storage = new Storage({
    credentials: JSON.parse(Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('ascii'))
  });
  
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Error parsing the upload file:', err);
      res.status(500).json({ error: 'Could not parse the upload file.' });
      return;
    }
    const file = files.audio.path;
    const originalFilename = files.audio.name;
    console.log(`Processing file: ${originalFilename}`);
    const extension = path.extname(originalFilename);
    const client = new speech.SpeechClient({
      credentials: JSON.parse(Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('ascii'))
    });    
    
    const metadata = await mm.parseFile(file);
    const sampleRateHertz = metadata.format.sampleRate;
    const codec = metadata.format.codec;
    const duration = metadata.format.duration;
    console.log(`File metadata: sampleRateHertz=${sampleRateHertz}, codec=${codec}, duration=${duration}`);
    
    async function checkFileExists(bucketName, filename) {
      console.log(`Checking if file exists in GCS: ${bucketName} -- ${filename}`);
      const [exists] = await storage.bucket(bucketName).file(filename).exists();
      return exists;
    }
    
    let audio;
    if (duration <= maxInlineDuration) {
      const audioBytes = fs.readFileSync(file).toString('base64');
      audio = { content: audioBytes };
    } else {
      const gcsUri = await uploadFileToGCS(storage, file, extension);
      console.log(`Uploaded file to GCS: ${gcsUri}`);
      audio = { uri: gcsUri };
    }
    
    const config = { 
      encoding: mapCodecToGoogleFormat(codec),
      sampleRateHertz: sampleRateHertz,
      languageCode: 'kn-IN',
    };
    const request = { audio: audio, config: config };
    console.log('Request:', JSON.stringify(request));
    
    function mapCodecToGoogleFormat(codec) {
      const codecMap = {
        'pcm_s16le': 'LINEAR16',
        'flac': 'FLAC',
        'mpeg': 'MP3',
        'aac': 'AAC',
        'vorbis': 'OGG_OPUS',
        'opus': 'OGG_OPUS',
        'alac': 'ALAC',
        'pcm_u8': 'LINEAR16',
        'pcm_s24le': 'LINEAR16',
        'pcm_s32le': 'LINEAR16',
      };
      return codecMap[codec] || 'LINEAR16';
    }
    
    const filename = path.basename(file);
    const filenameWithExtension = `${filename}${extension}`;
    let exists = await checkFileExists(bucketName, filenameWithExtension);
    
    let intervalId = null;
    let timeoutId = null;
    
    const checkInterval = 10000; // Check every 10 seconds
    const globalTimeout = 5 * 60 * 1000; // 5 minutes
    
    if (!exists) {
      intervalId = setInterval(async () => {
        exists = await checkFileExists(bucketName, filenameWithExtension);
        if (exists) {
          clearInterval(intervalId);
          clearTimeout(timeoutId);
          console.log('File found on GCS, starting transcription');
          transcribeAudio();
        }
      }, checkInterval);
      
      timeoutId = setTimeout(() => {
        clearInterval(intervalId);
        console.error('File does not exist on GCS after waiting for 5 minutes');
        res.status(500).send('File does not exist on GCS');
      }, globalTimeout);
    } else {
      console.log('File found on GCS, starting transcription');
      transcribeAudio();
    }
    
    async function transcribeAudio() {
      try {
        console.log('Starting transcription');
        const [operation] = await client.longRunningRecognize(request);
        const [response] = await operation.promise();
        console.log('Transcription response:', response);
        const transcription = response.results.map(result => result.alternatives[0].transcript).join('\n');
        console.log('Transcription:', transcription);
        res.status(200).send({ transcription });
      } catch (error) {
        console.error('Error transcribing audio:', error);
        res.status(500).send('Error transcribing audio');
      }
    }
  });
};