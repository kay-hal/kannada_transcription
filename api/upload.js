const speech = require('@google-cloud/speech');
const fs = require('fs');
const formidable = require('formidable-serverless');
const mm = require('music-metadata');

module.exports = async (req, res) => {
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(500).json({ error: 'Could not parse the upload file.' });
      return;
    }
    const file = files.audio.path;
    const audioBytes = fs.readFileSync(file).toString('base64');

    const client = new speech.SpeechClient({
      credentials: JSON.parse(Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('ascii'))
    });    // {
    //   keyFilename: 'path-to-your-google-api-key.json' // Ensure this is securely configured
    // });
    const metadata = await mm.parseFile(file);
    const sampleRateHertz = metadata.format.sampleRate;
    const codec = metadata.format.codec;
  
    const audio = { content: audioBytes };
    const config = { 
      encoding: mapCodecToGoogleFormat(codec),
      sampleRateHertz: sampleRateHertz,
      languageCode: 'kn-IN',
    };
    const request = { audio: audio, config: config };

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
      const [response] = await client.recognize(request);
      const transcription = response.results.map(result => result.alternatives[0].transcript).join('\n');
      res.status(200).send({ transcription });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).send('Error transcribing audio');
    }
  });
};
