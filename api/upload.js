const speech = require('@google-cloud/speech');
const fs = require('fs');
const formidable = require('formidable-serverless');

module.exports = async (req, res) => {
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(500).json({ error: 'Could not parse the upload file.' });
      return;
    }
    const file = files.audio.path;
    const audioBytes = fs.readFileSync(file).toString('base64');

    const client = new speech.SpeechClient();
    // {
    //   keyFilename: 'path-to-your-google-api-key.json' // Ensure this is securely configured
    // });

    const audio = { content: audioBytes };
    const config = { encoding: 'LINEAR16', sampleRateHertz: 16000, languageCode: 'kn-IN' };
    const request = { audio: audio, config: config };

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
