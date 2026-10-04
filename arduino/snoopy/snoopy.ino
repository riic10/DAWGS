// SnoopyGS controller. Prints one CSV line per sample at 9600 baud, read by
// web/src/input/arduino.js over Web Serial:
//
//   touch,button,distance,camX,camY,camPress,petX,petY,petPress
//
// Stick axes are raw analogRead values (0-1023, ~512 centred); presses are 1
// while held. The web page removes the dead zone and can flip axes
// (ARDUINO.stick in arduino.js), so keep this sketch dumb.

// Joystick 1: camera (orbit around the dog; click resets the view).
const int CAM_X = A2;
const int CAM_Y = A3;
const int CAM_SW = 3;

// Joystick 2: petting.
const int PET_X = A0;
const int PET_Y = A1;
const int PET_SW = 2;

const unsigned long SAMPLE_MS = 40; // 25 Hz; a full line takes ~30 ms at 9600 baud

// The touch sensor, ball button and ultrasonic sensor columns. Fill these in
// with your existing sensor code; returning 0 means "not touched / not
// pressed / no echo", which the page ignores.
int readTouch() { return 0; }
int readButton() { return 0; }
long readDistanceCm() { return 0; }

void setup() {
  Serial.begin(9600);
  // Joystick switches short to GND when pressed.
  pinMode(CAM_SW, INPUT_PULLUP);
  pinMode(PET_SW, INPUT_PULLUP);
}

void loop() {
  static unsigned long last = 0;
  unsigned long now = millis();
  if (now - last < SAMPLE_MS) return;
  last = now;

  Serial.print(readTouch()); Serial.print(',');
  Serial.print(readButton()); Serial.print(',');
  Serial.print(readDistanceCm()); Serial.print(',');
  Serial.print(analogRead(CAM_X)); Serial.print(',');
  Serial.print(analogRead(CAM_Y)); Serial.print(',');
  Serial.print(digitalRead(CAM_SW) == LOW ? 1 : 0); Serial.print(',');
  Serial.print(analogRead(PET_X)); Serial.print(',');
  Serial.print(analogRead(PET_Y)); Serial.print(',');
  Serial.println(digitalRead(PET_SW) == LOW ? 1 : 0);
}
