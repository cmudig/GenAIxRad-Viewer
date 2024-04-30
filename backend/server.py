
# Filename - server.py
 
# Import flask and datetime module for showing date and time
from flask import Flask
import datetime
 
x = datetime.datetime.now()
 
# Initializing flask app
app = Flask(__name__)

@app.route('/')
def test():
    return{"Status": "OK",
           "Time":x}

 
# Route for seeing a data
@app.route('/dicom')
def get_random_dicom():
    # generates a dicom image
    return {
        'Name':"geek", 
        "Age":"22",
        "Date":x, 
        "programming":"python"
        }
 
     
# Running app
if __name__ == '__main__':
    app.run(debug=True)