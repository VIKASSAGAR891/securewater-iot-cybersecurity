#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <WiFi.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>


// =====================================================
// PIN CONFIGURATION
// =====================================================

const int phPin = 34;
const int turbidityPin = 32;

const int buzzerPin = 27;
const int redLedPin = 25;
const int greenLedPin = 26;


// =====================================================
// WIFI / THINGSPEAK CONFIGURATION
// =====================================================

const char* ssid = "Wokwi-GUEST";
const char* password = "";

const char* server = "http://api.thingspeak.com/update";

String apiKey = "9CU0PLZEI3LD29LP";


// =====================================================
// DS18B20 TEMPERATURE SENSOR
// =====================================================

#define ONE_WIRE_BUS 4

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);


// =====================================================
// OLED CONFIGURATION
// =====================================================

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

Adafruit_SSD1306 display(
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  &Wire,
  -1
);


// =====================================================
// DEMONSTRATION MODE
// =====================================================
//
// The system deliberately alternates:
//
// Reading 1 -> SAFE
// Reading 2 -> SAFE
// Reading 3 -> UNSAFE
// Reading 4 -> UNSAFE
//
// Then the cycle repeats:
//
// Reading 5 -> SAFE
// Reading 6 -> SAFE
// Reading 7 -> UNSAFE
// Reading 8 -> UNSAFE
//
// This gives approximately 50% SAFE and 50% UNSAFE
// readings for demonstration and dataset generation.
// =====================================================

const bool DEMO_MODE = true;

int demoCounter = 0;


// =====================================================
// SAFE SENSOR RANGE
// =====================================================

const float SAFE_TEMP_MIN = 22.0;
const float SAFE_TEMP_MAX = 28.0;

const float SAFE_PH_MIN = 6.8;
const float SAFE_PH_MAX = 8.2;

const float SAFE_TURB_MIN = 10.0;
const float SAFE_TURB_MAX = 25.0;


// =====================================================
// UNSAFE SENSOR RANGE
// =====================================================
//
// The values deliberately violate at least one
// water-quality condition while remaining realistic
// for demonstration purposes.
// =====================================================

const float UNSAFE_TEMP_MIN = 23.0;
const float UNSAFE_TEMP_MAX = 27.0;

const float UNSAFE_PH_MIN = 4.2;
const float UNSAFE_PH_MAX = 5.0;

const float UNSAFE_TURB_MIN = 60.0;
const float UNSAFE_TURB_MAX = 75.0;


// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);


  // ---------------------------------------------------
  // Output pins
  // ---------------------------------------------------

  pinMode(buzzerPin, OUTPUT);
  digitalWrite(buzzerPin, LOW);

  pinMode(redLedPin, OUTPUT);
  pinMode(greenLedPin, OUTPUT);

  digitalWrite(redLedPin, LOW);
  digitalWrite(greenLedPin, LOW);


  // ---------------------------------------------------
  // Temperature sensor
  // ---------------------------------------------------

  sensors.begin();


  // ---------------------------------------------------
  // I2C
  // ---------------------------------------------------

  Wire.begin(21, 22);


  // ---------------------------------------------------
  // OLED
  // ---------------------------------------------------

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {

    Serial.println("OLED Failed");

    while (true);
  }


  // ---------------------------------------------------
  // WiFi
  // ---------------------------------------------------

  Serial.println();
  Serial.println("Connecting to WiFi...");

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);

    Serial.print(".");
  }

  Serial.println();

  Serial.println("WiFi Connected!");

  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());


  // ---------------------------------------------------
  // Demonstration information
  // ---------------------------------------------------

  Serial.println();

  Serial.println("=======================================");
  Serial.println(" SecureWater IoT Demonstration Mode");
  Serial.println(" 2 SAFE -> 2 UNSAFE readings");
  Serial.println(" Approximately 50/50 distribution");
  Serial.println("=======================================");
}


// =====================================================
// MAIN LOOP
// =====================================================

void loop() {


  // ===================================================
  // READ PHYSICAL SENSORS
  // ===================================================

  int phADC = analogRead(phPin);

  int turbADC = analogRead(turbidityPin);


  // ===================================================
  // pH CALCULATION
  // ===================================================

  float voltage = phADC * (3.3 / 4095.0);

  float ph = 7 + ((2.5 - voltage) / 0.18);


  // Keep pH within valid range

  if (ph < 0)
    ph = 0;

  if (ph > 14)
    ph = 14;


  // ===================================================
  // TURBIDITY CALCULATION
  // ===================================================

  float turbidity = (turbADC / 4095.0) * 100.0;


  // ===================================================
  // TEMPERATURE
  // ===================================================

  sensors.requestTemperatures();

  float temperature = sensors.getTempCByIndex(0);


  // ===================================================
  // DEMONSTRATION PROFILE
  // ===================================================
  //
  // Four-reading cycle:
  //
  // position 0 -> SAFE
  // position 1 -> SAFE
  // position 2 -> UNSAFE
  // position 3 -> UNSAFE
  //
  // Then repeat.
  // ===================================================

  bool demonstrationSafe = false;


  if (DEMO_MODE) {

    int position = demoCounter % 4;


    // =================================================
    // SAFE PROFILE
    // =================================================

    if (position < 2) {

      demonstrationSafe = true;


      // -----------------------------------------------
      // SAFE TEMPERATURE
      // -----------------------------------------------

      temperature =
          24.0 + ((demoCounter % 5) * 0.5);


      // -----------------------------------------------
      // SAFE pH
      // -----------------------------------------------

      ph =
          7.0 + ((demoCounter % 5) * 0.2);


      // -----------------------------------------------
      // SAFE TURBIDITY
      // -----------------------------------------------

      turbidity =
          10.0 + ((demoCounter % 5) * 2.0);
    }


    // =================================================
    // UNSAFE PROFILE
    // =================================================

    else {

      demonstrationSafe = false;


      // -----------------------------------------------
      // UNSAFE TEMPERATURE
      // -----------------------------------------------

      temperature =
          23.0 + ((demoCounter % 4) * 1.0);


      // -----------------------------------------------
      // UNSAFE pH
      // -----------------------------------------------

      ph =
          4.2 + ((demoCounter % 4) * 0.2);


      // -----------------------------------------------
      // UNSAFE TURBIDITY
      // -----------------------------------------------

      turbidity =
          60.0 + ((demoCounter % 4) * 4.0);
    }
  }


  // ===================================================
  // pH STATUS
  // ===================================================

  String phStatus;


  if (ph < 6.5)

    phStatus = "ACIDIC";

  else if (ph <= 8.5)

    phStatus = "SAFE";

  else

    phStatus = "ALKALINE";


  // ===================================================
  // WATER QUALITY DECISION
  // ===================================================
  //
  // SAFE requires ALL conditions:
  //
  // Temperature: 20-35 C
  // pH:          6.5-8.5
  // Turbidity:   <30%
  //
  // Otherwise -> UNSAFE
  // ===================================================

  String waterStatus;

  int waterQualityValue;


  bool isTempSafe =
      (temperature >= 20.0 &&
       temperature <= 35.0);


  bool isPhSafe =
      (ph >= 6.5 &&
       ph <= 8.5);


  bool isTurbiditySafe =
      (turbidity < 30.0);


  // ===================================================
  // SAFE
  // ===================================================

  if (isTempSafe &&
      isPhSafe &&
      isTurbiditySafe) {

    waterStatus = "SAFE";

    waterQualityValue = 1;


    // Green LED ON
    digitalWrite(greenLedPin, HIGH);

    // Red LED OFF
    digitalWrite(redLedPin, LOW);

    // Buzzer OFF
    digitalWrite(buzzerPin, LOW);
  }


  // ===================================================
  // UNSAFE
  // ===================================================

  else {

    waterStatus = "UNSAFE";

    waterQualityValue = 0;


    // Green LED OFF
    digitalWrite(greenLedPin, LOW);

    // Red LED ON
    digitalWrite(redLedPin, HIGH);


    // Short warning beep
    digitalWrite(buzzerPin, HIGH);

    delay(500);

    digitalWrite(buzzerPin, LOW);
  }


  // ===================================================
  // SERIAL MONITOR
  // ===================================================

  Serial.println("---------------------------------------");


  Serial.print("Reading Number : ");
  Serial.println(demoCounter + 1);


  Serial.print("Demo Profile   : ");

  if (waterStatus == "SAFE")

    Serial.println("SAFE");

  else

    Serial.println("UNSAFE");


  Serial.print("Temperature : ");
  Serial.print(temperature, 2);
  Serial.println(" C");


  Serial.print("pH : ");
  Serial.print(ph, 2);

  Serial.print(" (");
  Serial.print(phStatus);
  Serial.println(")");


  Serial.print("Turbidity : ");
  Serial.print(turbidity, 1);
  Serial.println(" %");


  Serial.print("Water Quality : ");
  Serial.println(waterStatus);


  // ===================================================
  // OLED DISPLAY
  // ===================================================

  display.clearDisplay();

  display.setTextSize(1);

  display.setTextColor(SSD1306_WHITE);


  // Title
  display.setCursor(0, 0);

  display.println("Water Monitor");


  // Temperature
  display.setCursor(0, 14);

  display.print("Temp: ");

  display.print(temperature, 1);

  display.println(" C");


  // pH
  display.print("pH  : ");

  display.println(ph, 2);


  // Turbidity
  display.print("Turb: ");

  display.print(turbidity, 1);

  display.println("%");


  // Status
  display.setCursor(0, 54);

  display.print("Status: ");

  display.println(waterStatus);


  display.display();


  // ===================================================
  // SEND DATA TO THINGSPEAK
  // ===================================================

  if (WiFi.status() == WL_CONNECTED) {

    HTTPClient http;


    String url =
        String(server)
        + "?api_key=" + apiKey
        + "&field1=" + String(temperature, 2)
        + "&field2=" + String(ph, 2)
        + "&field3=" + String(turbidity, 1)
        + "&field4=" + String(waterQualityValue);


    http.begin(url);


    int httpCode = http.GET();


    Serial.print("ThingSpeak Response: ");

    Serial.println(httpCode);


    http.end();
  }


  else {

    Serial.println("WiFi Disconnected!");
  }


  // ===================================================
  // MOVE TO NEXT READING
  // ===================================================

  demoCounter++;


  // ===================================================
  // THINGSPEAK UPDATE INTERVAL
  // ===================================================
  //
  // 20 seconds provides a safe margin between
  // ThingSpeak updates.
  // ===================================================

  delay(20000);
}