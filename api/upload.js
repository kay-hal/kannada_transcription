const speech = require('@google-cloud/speech');
const {Storage} = require('@google-cloud/storage');
const fs = require('fs');
const formidable = require('formidable-serverless');
const mm = require('music-metadata');

const bucketName = 'kannada-transcription-bucket';
const storage = new Storage();
const path = require('path');

async function uploadFileToGCS(filepath, extension) {
  const filename = path.basename(filepath);
  const destination = `${filename}${extension}`;
  await storage.bucket(bucketName).upload(filepath, {
    destination: destination,
    gzip: true,
    metadata: {
      cacheControl: 'public, max-age=31536000',
    },
  });
  console.log(`${destination} uploaded to ${bucketName}.`);
  return `gs://${bucketName}/${destination}`;
}

module.exports = async (req, res) => {
  const form = new formidable.IncomingForm();
  const maxInlineDuration = 6; 

  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(500).json({ error: 'Could not parse the upload file.' });
      return;
    }
    const file = files.audio.path;
    const originalFilename = files.audio.name;
    const extension = path.extname(originalFilename);
    // const audioBytes = fs.readFileSync(file).toString('base64');

    const client = new speech.SpeechClient({
      credentials: JSON.parse(Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('ascii'))
    });    
    
    const metadata = await mm.parseFile(file);
    const sampleRateHertz = metadata.format.sampleRate;
    const codec = metadata.format.codec;
    const duration = metadata.format.duration;
  
    let audio;
    if (duration <= maxInlineDuration) {
      const audioBytes = fs.readFileSync(file).toString('base64');
      audio = { content: audioBytes };
    } else {
      const gcsUri = await uploadFileToGCS(file, extension);
      console.log(`Uploaded file to GCS: ${gcsUri}`);
      audio = { uri: gcsUri };
    }
  
    const config = { 
      encoding: mapCodecToGoogleFormat(codec),
      sampleRateHertz: sampleRateHertz,
      languageCode: 'kn-IN',
    };
    const request = { audio: audio, config: config };
    console.log('Request:', request);

    function mapCodecToGoogleFormat(codec) {
      // This function should translate from codec names to Google's expected values
      const codecMap = {
        'pcm_s16le': 'LINEAR16',  // PCM signed 16-bit little-endian
        'flac': 'FLAC',  // FLAC (Free Lossless Audio Codec)
        'mpeg': 'MP3',  // MPEG Audio Layer III
        'aac': 'AAC',  // Advanced Audio Coding
        'vorbis': 'OGG_OPUS',  // Vorbis codec, typically in an OGG container
        'opus': 'OGG_OPUS',  // Opus codec, typically in an OGG container
        'alac': 'ALAC',  // Apple Lossless Audio Codec
        'pcm_u8': 'LINEAR16',  // PCM unsigned 8-bit. Google doesn't support 8-bit, so we map it to 16-bit
        'pcm_s24le': 'LINEAR16',  // PCM signed 24-bit little-endian. Google doesn't support 24-bit, so we map it to 16-bit
        'pcm_s32le': 'LINEAR16',  // PCM signed 32-bit little-endian. Google doesn't support 32-bit, so we map it to 16-bit
      };
      return codecMap[codec] || 'LINEAR16';  // default to LINEAR16 if unknown
    }
    
    try {
      const [operation] = await client.longRunningRecognize(request);
      const [response] = await operation.promise();
      console.log(response);
      const transcription = response.results.map(result => result.alternatives[0].transcript).join('\n');
      res.status(200).send({ transcription });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).send('Error transcribing audio');
    }
  });
};
