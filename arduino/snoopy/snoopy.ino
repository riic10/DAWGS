// SnoopyGS controller. Prints one CSV line per sample at 9600 baud, read by
// web/src/input/arduino.js over Web Serial:
//
//   X1,Y1,R3_1,X2,Y2,R3_2 (X1 petting, Y1 ball, X2/Y2 camera)
//
// Stick axes are raw analogRead values (0-1023, ~512 centred); presses are 1
// while held. The web page removes the dead zone and can flip axes
// (ARDUINO.stick in arduino.js), so keep this sketch dumb.

// Joystick 2: camera (orbit around the dog; click resets the view).
const int CAM_X = A2;
const int CAM_Y = A3;
const int CAM_SW = 3;

// Joystick 1: horizontal pets; vertical readies/throws the ball.
const int PET_X = A0;
const int PET_Y = A1;
const int PET_SW = 2;

const unsigned long SAMPLE_MS = 40; // 25 Hz; a full line takes ~30 ms at 9600 baud

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

  Serial.print(analogRead(PET_X)); Serial.print(',');
  Serial.print(analogRead(PET_Y)); Serial.print(',');
  Serial.print(digitalRead(PET_SW) == LOW ? 1 : 0); Serial.print(',');
  Serial.print(analogRead(CAM_X)); Serial.print(',');
  Serial.print(analogRead(CAM_Y)); Serial.print(',');
  Serial.println(digitalRead(CAM_SW) == LOW ? 1 : 0);
}
